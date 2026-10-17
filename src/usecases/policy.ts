import { withWriteTransaction, type Executor } from "@/src/db/client";
import {
  appendEvent,
  appendPolicyVersion,
  ensureLedgerPeriod,
  getCurrentPolicy,
  getLatestExtraction,
  getOrganization,
  listInvoices,
  listLatestDecisions,
  listVendors,
} from "@/src/db/repositories";
import {
  PolicyError,
  add,
  applyPolicyEdit,
  parsePolicy,
  periodKey,
  policyEditFromYaml,
  toUsd,
  zero,
  type Controls,
  type Currency,
  type Decision,
  type Finding,
  type FindingCode,
  type Invoice,
  type Money,
  type Policy,
  type PolicyVersion,
  type Ulid,
  type Verdict,
} from "@/src/domain";
import { decidingFinding, evaluate, type PayeeMatch, type PriorInvoice } from "@/src/engine";
import { resolvePayee } from "@/src/resolve";

import { businessDateOf, engineNow } from "./business-day";
import { readingFor, reevaluateWithCurrentPolicy } from "./correct-invoice";
import { readEvaluationContext, type DecideDeps } from "./decide";
import { UseCaseError } from "./errors";

/**
 * Política: ver qué cambiaría, guardar una versión nueva y cambiar los interruptores
 * (docs/arquitectura.md §4 "Replay", docs/interfaz.md §5.4). Es donde se ve que las reglas
 * mandan: bajar un umbral y saber, antes de guardar, qué facturas cambiarían de veredicto.
 *
 * - Lo que se reevalúa son las facturas abiertas: escaladas que esperan a una persona y
 *   frenadas. Nunca las pagadas, que ya comprometieron presupuesto y saldo.
 * - La vista previa no escribe nada. Recorre las facturas en el mismo orden que el replay y
 *   acumula en memoria lo que cada `pagar` comprometería, así el diff es el que se obtendrá.
 * - Guardar exige un aprobador de la lista, crea la versión v+1 firmada, aplica el límite del
 *   presupuesto del periodo y reevalúa las abiertas; todo queda en la bitácora.
 */

export type PolicyChange = {
  readonly invoiceId: Ulid;
  readonly reference: string;
  readonly before: { readonly verdict: Verdict; readonly rule: FindingCode | null };
  readonly after: { readonly verdict: Verdict; readonly rule: FindingCode | null };
};

export type PolicyPreview = {
  /** Facturas abiertas que se evaluaron. */
  readonly evaluated: number;
  /** Las que cambiarían de veredicto o de regla. */
  readonly changes: readonly PolicyChange[];
  /** Abiertas sin lectura guardada (escaladas por error de proceso): no se pueden reevaluar. */
  readonly skipped: number;
};

/** Política candidata a partir del YAML del editor: la parte editable sobre la vigente. */
export function candidateFromYaml(current: Policy, yaml: string): Policy {
  return applyPolicyEdit(current, policyEditFromYaml(yaml));
}

type OpenInvoice = { readonly invoice: Invoice; readonly decision: Decision };

/** Facturas abiertas, las más viejas primero: el orden en que el replay las reevalúa. */
async function openInvoices(deps: DecideDeps, organizationId: Ulid): Promise<OpenInvoice[]> {
  const [waiting, decided] = await Promise.all([
    listInvoices(deps.db, organizationId, { status: "esperando_aprobacion", limit: 500 }),
    listInvoices(deps.db, organizationId, { status: "decidida", limit: 500 }),
  ]);
  const invoices = [...waiting, ...decided];
  const latest = await listLatestDecisions(
    deps.db,
    organizationId,
    invoices.map((i) => i.id),
  );
  return invoices
    .flatMap((invoice) => {
      const decision = latest.get(invoice.id);
      if (!decision) return [];
      const open =
        (invoice.status === "esperando_aprobacion" && decision.verdict === "escalar") ||
        (invoice.status === "decidida" && decision.verdict === "frenar");
      return open ? [{ invoice, decision }] : [];
    })
    .sort((a, b) => (a.invoice.received_at < b.invoice.received_at ? -1 : 1));
}

function summary(decision: { readonly verdict: Verdict; readonly findings: readonly Finding[] }) {
  return { verdict: decision.verdict, rule: decidingFinding(decision)?.code ?? null };
}

function today(deps: DecideDeps): string {
  return deps.businessDate ?? businessDateOf(deps.now(), deps.timeZone);
}

export async function previewPolicyChange(
  deps: DecideDeps,
  input: { readonly organizationId: Ulid; readonly candidate: Policy },
): Promise<PolicyPreview> {
  const organization = await getOrganization(deps.db, input.organizationId);
  const [open, vendors] = await Promise.all([
    openInvoices(deps, organization.id),
    listVendors(deps.db, organization.id),
  ]);
  const changes: PolicyChange[] = [];
  let skipped = 0;
  // Lo que los `pagar` anteriores del mismo replay ya comprometerían, en USD y por moneda.
  // En modo de prueba el replay no reserva nada, así que tampoco se acumula aquí.
  const dryRun = input.candidate.controls.dry_run;
  let committedUsd = zero("USD");
  const spent = new Map<Currency, Money>();
  // Facturas que el replay pagaría antes: para las siguientes ya cuentan como pagadas en el
  // historial (primer pago, monto atípico, duplicados), igual que después de guardar.
  const predicted = new Map<Ulid, PriorInvoice["outcome"]>();

  for (const { invoice, decision } of open) {
    const stored = await getLatestExtraction(deps.db, organization.id, invoice.id);
    if (!stored) {
      skipped += 1;
      continue;
    }
    const reading = readingFor(invoice, decision, stored.record);
    const extraction = stored.record.extraction;
    const payee: PayeeMatch =
      extraction.kind === "invoice"
        ? resolvePayee(extraction.fields, vendors)
        : { kind: "unknown", closest: null };
    const context = await readEvaluationContext(deps, {
      organization,
      invoice,
      reading,
      payee,
      today: today(deps),
      policy: input.candidate,
      assumeNewPeriod: true,
    });
    const evaluation = evaluate({
      ...context,
      ledger: context.ledger && {
        ...context.ledger,
        committed: context.ledger.committed + committedUsd.amount,
      },
      balances: context.balances.map((b) => ({
        ...b,
        available: b.available - (spent.get(b.currency)?.amount ?? 0),
      })),
      prior: context.prior.map((row) => {
        const outcome = predicted.get(row.invoice_id);
        return outcome ? { ...row, outcome } : row;
      }),
    });
    if (evaluation.verdict === "pagar") {
      predicted.set(invoice.id, dryRun ? "simulada" : "pagar");
      if (!dryRun && decision.amount) {
        const { currency } = decision.amount;
        committedUsd = add(committedUsd, toUsd(decision.amount, organization.fx));
        spent.set(currency, add(spent.get(currency) ?? zero(currency), decision.amount));
      }
    }
    const before = summary(decision);
    const after = summary(evaluation);
    if (before.verdict !== after.verdict || before.rule !== after.rule) {
      changes.push({ invoiceId: invoice.id, reference: invoice.reference, before, after });
    }
  }
  return { evaluated: open.length, changes, skipped };
}

/**
 * Quien firma debe estar en la lista de aprobadores de la política vigente. Se lee dentro de
 * la transacción que escribe la versión nueva: un cambio simultáneo de otra pestaña (apagar
 * pagos, otra versión) no se pisa.
 */
async function authorize(exec: Executor, organizationId: Ulid, signer: string | null) {
  const current = await getCurrentPolicy(exec, organizationId);
  if (!current) throw new PolicyError(["La empresa no tiene política vigente"]);
  if (signer === null || !current.content.protected.approvers.includes(signer)) {
    throw new UseCaseError(
      "not_authorized",
      "Quien firma la política no está en la lista de aprobadores",
      { action: "Elige un aprobador de la lista" },
    );
  }
  return { current, signer };
}

export type ReplayResult = {
  readonly version: PolicyVersion;
  readonly evaluated: number;
  readonly changed: number;
  /** Abiertas sin lectura guardada: no se reevalúan, como en la vista previa. */
  readonly skipped: number;
  /** Las que no se pudieron reevaluar: otra persona las cambió o algo falló; siguen abiertas. */
  readonly failed: number;
};

/** Guarda la política candidata como versión nueva y reevalúa las facturas abiertas. */
export async function savePolicy(
  deps: DecideDeps,
  input: {
    readonly organizationId: Ulid;
    readonly candidate: Policy;
    /** Versión sobre la que se editó: si ya no es la vigente, no se guarda. */
    readonly baseVersion: number;
    readonly signedBy: string | null;
    readonly note: string | null;
  },
): Promise<ReplayResult> {
  const at = deps.now().toISOString();
  const traceId = `tr-${deps.newId()}`;
  const { version, signer } = await withWriteTransaction(deps.db, async (tx) => {
    const { current, signer } = await authorize(tx, input.organizationId, input.signedBy);
    if (current.version !== input.baseVersion) {
      throw new UseCaseError(
        "policy_changed",
        `La política cambió desde que la abriste: ahora es la v${String(current.version)}`,
        { action: "Recarga la página y vuelve a aplicar tus cambios" },
      );
    }
    // Las claves protegidas y los controles nunca llegan desde el editor.
    const content = parsePolicy({
      ...input.candidate,
      protected: current.content.protected,
      controls: current.content.controls,
    });
    const saved = await appendPolicyVersion(
      tx,
      input.organizationId,
      {
        content,
        signedBy: signer,
        signedAt: at,
        ...(input.note ? { note: input.note.slice(0, 500) } : {}),
      },
      deps.newId,
    );
    // El límite del periodo cambia al guardar la política, no con cada factura.
    const { budget } = content.limits;
    await ensureLedgerPeriod(
      tx,
      input.organizationId,
      periodKey(engineNow(today(deps)), budget.period),
      budget.currency,
      budget.amount,
      at,
    );
    await appendEvent(tx, {
      id: deps.newId(),
      organization_id: input.organizationId,
      type: "policy.saved",
      actor: { kind: "humano", name: signer },
      invoice_id: null,
      decision_id: null,
      data: { version: saved.version, content_hash: saved.content_hash, previous: current.version },
      trace_id: traceId,
      occurred_at: at,
    });
    return { version: saved, signer };
  });

  const open = await openInvoices(deps, input.organizationId);
  let changed = 0;
  let skipped = 0;
  let failed = 0;
  for (const { invoice, decision } of open) {
    if (!(await getLatestExtraction(deps.db, input.organizationId, invoice.id))) {
      skipped += 1;
      continue;
    }
    try {
      const result = await reevaluateWithCurrentPolicy(deps, {
        organizationId: input.organizationId,
        invoiceId: invoice.id,
        actor: signer,
        traceId,
      });
      const before = summary(decision);
      const after = summary(result.decision);
      if (before.verdict !== after.verdict || before.rule !== after.rule) changed += 1;
    } catch {
      // La versión ya está guardada: una factura que no se pudo reevaluar queda abierta con
      // su decisión anterior y se cuenta, sin cortar el replay de las demás ni su registro.
      failed += 1;
    }
  }
  await withWriteTransaction(deps.db, (tx) =>
    appendEvent(tx, {
      id: deps.newId(),
      organization_id: input.organizationId,
      type: "policy.replayed",
      actor: { kind: "humano", name: signer },
      invoice_id: null,
      decision_id: null,
      data: { version: version.version, evaluated: open.length, changed, skipped, failed },
      trace_id: traceId,
      occurred_at: deps.now().toISOString(),
    }),
  );
  return { version, evaluated: open.length, changed, skipped, failed };
}

/**
 * Cambia un interruptor (pagos, modo de prueba, autonomía). No es política sino control,
 * pero queda versionado y en la bitácora con quién y cuándo. No reevalúa: cada factura
 * afectada se reevalúa desde su detalle.
 */
export async function changeControls(
  deps: DecideDeps,
  input: {
    readonly organizationId: Ulid;
    readonly controls: Partial<Controls>;
    readonly signedBy: string | null;
  },
): Promise<PolicyVersion> {
  const at = deps.now().toISOString();
  return withWriteTransaction(deps.db, async (tx) => {
    const { current, signer } = await authorize(tx, input.organizationId, input.signedBy);
    const controls = { ...current.content.controls, ...input.controls };
    const content = parsePolicy({ ...current.content, controls });
    const saved = await appendPolicyVersion(
      tx,
      input.organizationId,
      { content, signedBy: signer, signedAt: at, note: "Cambio de interruptores" },
      deps.newId,
    );
    await appendEvent(tx, {
      id: deps.newId(),
      organization_id: input.organizationId,
      type: "controls.changed",
      actor: { kind: "humano", name: signer },
      invoice_id: null,
      decision_id: null,
      data: { version: saved.version, from: current.content.controls, to: controls },
      trace_id: `tr-${deps.newId()}`,
      occurred_at: at,
    });
    return saved;
  });
}
