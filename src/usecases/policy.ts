import { withWriteTransaction, type Executor } from "@/src/db/client";
import {
  appendEvent,
  appendPolicyVersion,
  ensureLedgerPeriod,
  getCurrentPolicy,
  getLatestExtraction,
  getOrganization,
  listEvents,
  listDecisionsByInvoices,
  listInvoices,
  listLatestDecisions,
  listVendors,
} from "@/src/db/repositories";
import {
  PolicyError,
  add,
  ControlsSchema,
  applyPolicyEdit,
  controlsLoosenings,
  parsePolicy,
  parsePolicyEdit,
  periodKey,
  policyEditFromYaml,
  policyLoosenings,
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
 * - Cuatro ojos: un cambio que afloja la política (umbral más alto, beneficiario nuevo, una
 *   regla que pasa de frenar a escalar) no entra en vigor con una sola firma. Queda como
 *   propuesta en la bitácora hasta que otra persona de la lista la apruebe o alguien la
 *   descarte. Un cambio igual o más estricto se guarda directo.
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
  const histories = await listDecisionsByInvoices(
    deps.db,
    organization.id,
    open.map((o) => o.invoice.id),
  );
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
    const reading = readingFor(invoice, histories.get(invoice.id) ?? [decision], stored.record);
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
    /** Segunda firma de una propuesta que afloja la política: quién aprueba y cuál. */
    readonly secondSignature?: { readonly proposalId: Ulid; readonly approvedBy: string };
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
    const second = input.secondSignature;
    if (policyLoosenings(current.content, content).length > 0) {
      if (!second) {
        throw new UseCaseError(
          "second_signature_required",
          "Este cambio afloja las reglas: entra en vigor con la firma de otra persona",
          { action: "Guárdalo como propuesta para que otra persona de la lista lo apruebe" },
        );
      }
      await assertSecondSignature(tx, input.organizationId, current, second, signer);
    }
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
      data: {
        version: saved.version,
        content_hash: saved.content_hash,
        previous: current.version,
        ...(second ? { approved_by: second.approvedBy, proposal_id: second.proposalId } : {}),
      },
      trace_id: traceId,
      occurred_at: at,
    });
    if (second) {
      await appendEvent(tx, {
        id: deps.newId(),
        organization_id: input.organizationId,
        type: "policy.proposal_closed",
        actor: { kind: "humano", name: second.approvedBy },
        invoice_id: null,
        decision_id: null,
        data: { proposal_id: second.proposalId, outcome: "aprobada", version: saved.version },
        trace_id: traceId,
        occurred_at: at,
      });
    }
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
    /** Segunda firma de una propuesta que enciende algo: quién aprueba y cuál. */
    readonly secondSignature?: { readonly proposalId: Ulid; readonly approvedBy: string };
  },
): Promise<PolicyVersion> {
  const at = deps.now().toISOString();
  return withWriteTransaction(deps.db, async (tx) => {
    const { current, signer } = await authorize(tx, input.organizationId, input.signedBy);
    const controls = { ...current.content.controls, ...input.controls };
    const content = parsePolicy({ ...current.content, controls });
    const second = input.secondSignature;
    if (controlsLoosenings(current.content.controls, controls).length > 0) {
      if (!second) {
        throw new UseCaseError(
          "second_signature_required",
          "Encender un interruptor afloja el control: entra en vigor con la firma de otra persona",
          { action: "Queda como propuesta para que otra persona de la lista la apruebe" },
        );
      }
      await assertSecondSignature(tx, input.organizationId, current, second, signer);
    }
    const saved = await appendPolicyVersion(
      tx,
      input.organizationId,
      {
        content,
        signedBy: signer,
        signedAt: at,
        note: second
          ? `Cambio de interruptores · Segunda firma: ${second.approvedBy}`
          : "Cambio de interruptores",
      },
      deps.newId,
    );
    if (second) {
      await appendEvent(tx, {
        id: deps.newId(),
        organization_id: input.organizationId,
        type: "policy.proposal_closed",
        actor: { kind: "humano", name: second.approvedBy },
        invoice_id: null,
        decision_id: null,
        data: { proposal_id: second.proposalId, outcome: "aprobada", version: saved.version },
        trace_id: `tr-${deps.newId()}`,
        occurred_at: at,
      });
    }
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

// ---------------------------------------------------------------------------
// Cuatro ojos: proponer, aprobar o descartar un cambio que afloja la política.
// ---------------------------------------------------------------------------

/** Un cambio que afloja la política, a la espera de la firma de otra persona. */
export type PolicyProposal = {
  readonly id: Ulid;
  /** Qué se propone: una versión de la política o encender interruptores. */
  readonly kind: "politica" | "controles";
  /** Interruptores pedidos, si es un cambio de interruptores. */
  readonly controls: Controls | null;
  readonly proposedBy: string;
  readonly proposedAt: string;
  /** Versión sobre la que se propuso. Si la vigente ya es otra, la propuesta venció. */
  readonly baseVersion: number;
  readonly candidate: Policy;
  /** Lo que afloja, en frases para quien aprueba. */
  readonly loosenings: readonly string[];
  readonly note: string | null;
  /** La política cambió desde que se propuso: ya no se puede aprobar, solo descartar. */
  readonly stale: boolean;
};

/** Cuántos eventos de propuesta se miran: una empresa tiene a lo sumo una abierta. */
const PROPOSAL_SCAN = 50;

/**
 * La propuesta abierta, o null: la última `policy.proposed` sin su `policy.proposal_closed`.
 * Se reconstruye desde la bitácora, que es append-only: aprobar o descartar es otro evento.
 */
async function openProposal(
  exec: Executor,
  organizationId: Ulid,
  current: PolicyVersion,
): Promise<PolicyProposal | null> {
  const [proposed, closed] = await Promise.all([
    listEvents(exec, organizationId, { type: "policy.proposed", limit: PROPOSAL_SCAN }),
    listEvents(exec, organizationId, { type: "policy.proposal_closed", limit: PROPOSAL_SCAN }),
  ]);
  const done = new Set(closed.map((e) => e.data["proposal_id"]));
  const event = proposed.find((e) => !done.has(e.id));
  if (!event || event.actor.kind !== "humano") return null;
  const baseVersion = Number(event.data["base_version"]);
  const loosenings = event.data["loosenings"];
  const note = event.data["note"];
  const kind = event.data["kind"] === "controles" ? "controles" : "politica";
  let candidate: Policy;
  let controls: Controls | null = null;
  try {
    if (kind === "controles") {
      controls = ControlsSchema.parse(event.data["controls"]);
      candidate = parsePolicy({ ...current.content, controls });
    } else {
      candidate = applyPolicyEdit(current.content, parsePolicyEdit(event.data["edit"]));
    }
  } catch {
    // Una propuesta que ya no valida contra el esquema no se puede aprobar: no se muestra.
    return null;
  }
  return {
    id: event.id,
    kind,
    controls,
    proposedBy: event.actor.name,
    proposedAt: event.occurred_at,
    baseVersion,
    candidate,
    loosenings: Array.isArray(loosenings)
      ? loosenings.filter((l): l is string => typeof l === "string")
      : [],
    note: typeof note === "string" ? note : null,
    stale: baseVersion !== current.version,
  };
}

/** La propuesta abierta de la empresa, para la pantalla de Reglas. */
export async function loadPolicyProposal(
  db: Executor,
  organizationId: Ulid,
): Promise<PolicyProposal | null> {
  const current = await getCurrentPolicy(db, organizationId);
  return current ? openProposal(db, organizationId, current) : null;
}

/** Dentro de la transacción que guarda: la propuesta sigue abierta, vigente y la firma otro. */
async function assertSecondSignature(
  tx: Executor,
  organizationId: Ulid,
  current: PolicyVersion,
  second: { readonly proposalId: Ulid; readonly approvedBy: string },
  signer: string,
): Promise<void> {
  const proposal = await openProposal(tx, organizationId, current);
  if (!proposal || proposal.id !== second.proposalId || proposal.stale) {
    throw new UseCaseError(
      "proposal_closed",
      "La propuesta ya no está pendiente o la política cambió desde que se propuso",
      { action: "Recarga la página; si el cambio sigue haciendo falta, propónlo de nuevo" },
    );
  }
  if (!current.content.protected.approvers.includes(second.approvedBy)) {
    throw new UseCaseError("not_authorized", "Quien aprueba no está en la lista de aprobadores", {
      action: "Elige un aprobador de la lista",
    });
  }
  // Cuatro ojos: dos personas distintas, quien propuso (y firma la versión) y quien aprueba.
  if (second.approvedBy === proposal.proposedBy || second.approvedBy === signer) {
    throw new UseCaseError(
      "second_signature_required",
      "Quien propuso el cambio no puede aprobarlo: hace falta otra persona de la lista",
      { action: "Pide a otro aprobador que lo revise y lo firme" },
    );
  }
}

export type SubmitResult =
  | ({ readonly kind: "guardada" } & ReplayResult)
  | { readonly kind: "propuesta"; readonly proposal: PolicyProposal };

/**
 * Lo que hace el botón Guardar: si el cambio no afloja nada, se guarda y se reevalúan las
 * abiertas; si afloja, queda como propuesta y la política vigente no cambia.
 */
export async function submitPolicy(
  deps: DecideDeps,
  input: {
    readonly organizationId: Ulid;
    readonly candidate: Policy;
    readonly baseVersion: number;
    readonly signedBy: string | null;
    readonly note: string | null;
  },
): Promise<SubmitResult> {
  const at = deps.now().toISOString();
  const outcome = await withWriteTransaction(deps.db, async (tx) => {
    const { current, signer } = await authorize(tx, input.organizationId, input.signedBy);
    if (current.version !== input.baseVersion) {
      throw new UseCaseError(
        "policy_changed",
        `La política cambió desde que la abriste: ahora es la v${String(current.version)}`,
        { action: "Recarga la página y vuelve a aplicar tus cambios" },
      );
    }
    const content = parsePolicy({
      ...input.candidate,
      protected: current.content.protected,
      controls: current.content.controls,
    });
    const loosenings = policyLoosenings(current.content, content);
    if (loosenings.length === 0) return null;
    const open = await openProposal(tx, input.organizationId, current);
    if (open && !open.stale) {
      throw new UseCaseError(
        "proposal_pending",
        `Ya hay un cambio de ${open.proposedBy} esperando la segunda firma`,
        { action: "Apruébalo o descártalo antes de proponer otro" },
      );
    }
    const traceId = `tr-${deps.newId()}`;
    if (open) {
      // Una propuesta vencida (la política cambió después) se cierra al proponer otra.
      await appendEvent(tx, {
        id: deps.newId(),
        organization_id: input.organizationId,
        type: "policy.proposal_closed",
        actor: { kind: "humano", name: signer },
        invoice_id: null,
        decision_id: null,
        data: { proposal_id: open.id, outcome: "vencida" },
        trace_id: traceId,
        occurred_at: at,
      });
    }
    const id = deps.newId();
    const edit = parsePolicyEdit({
      limits: content.limits,
      allowed_payees: content.allowed_payees,
      rules: content.rules,
    });
    const note = input.note ? input.note.slice(0, 500) : null;
    await appendEvent(tx, {
      id,
      organization_id: input.organizationId,
      type: "policy.proposed",
      actor: { kind: "humano", name: signer },
      invoice_id: null,
      decision_id: null,
      data: { kind: "politica", base_version: current.version, edit, loosenings, note },
      trace_id: traceId,
      occurred_at: at,
    });
    const proposal: PolicyProposal = {
      id,
      kind: "politica",
      controls: null,
      proposedBy: signer,
      proposedAt: at,
      baseVersion: current.version,
      candidate: content,
      loosenings,
      note,
      stale: false,
    };
    return proposal;
  });
  if (outcome) return { kind: "propuesta", proposal: outcome };
  return { kind: "guardada", ...(await savePolicy(deps, input)) };
}

/**
 * La segunda firma: otra persona de la lista aprueba la propuesta. Se guarda como versión
 * nueva firmada por quien la propuso, con la aprobación en la nota y en la bitácora, y se
 * reevalúan las abiertas como en cualquier guardado.
 */
export type ApprovedProposal =
  | ({ readonly kind: "politica" } & ReplayResult)
  | { readonly kind: "controles"; readonly version: PolicyVersion };

export async function approvePolicyProposal(
  deps: DecideDeps,
  input: {
    readonly organizationId: Ulid;
    readonly proposalId: Ulid;
    readonly approver: string | null;
  },
): Promise<ApprovedProposal> {
  const proposal = await loadPolicyProposal(deps.db, input.organizationId);
  if (!proposal || proposal.id !== input.proposalId || proposal.stale) {
    throw new UseCaseError(
      "proposal_closed",
      "La propuesta ya no está pendiente o la política cambió desde que se propuso",
      { action: "Recarga la página; si el cambio sigue haciendo falta, propónlo de nuevo" },
    );
  }
  if (input.approver === null) {
    throw new UseCaseError("not_authorized", "Elige quién firma para aprobar el cambio", {
      action: "Elige un aprobador de la lista",
    });
  }
  const secondSignature = { proposalId: proposal.id, approvedBy: input.approver };
  if (proposal.kind === "controles" && proposal.controls) {
    const version = await changeControls(deps, {
      organizationId: input.organizationId,
      controls: proposal.controls,
      signedBy: proposal.proposedBy,
      secondSignature,
    });
    return { kind: "controles", version };
  }
  const note = `Segunda firma: ${input.approver}${proposal.note ? ` · ${proposal.note}` : ""}`;
  const replay = await savePolicy(deps, {
    organizationId: input.organizationId,
    candidate: proposal.candidate,
    baseVersion: proposal.baseVersion,
    signedBy: proposal.proposedBy,
    note: note.slice(0, 500),
    secondSignature,
  });
  return { kind: "politica", ...replay };
}

/** Descarta la propuesta abierta. Cualquiera de la lista puede, también quien la propuso. */
export async function discardPolicyProposal(
  deps: DecideDeps,
  input: {
    readonly organizationId: Ulid;
    readonly proposalId: Ulid;
    readonly by: string | null;
  },
): Promise<void> {
  const at = deps.now().toISOString();
  await withWriteTransaction(deps.db, async (tx) => {
    const { current, signer } = await authorize(tx, input.organizationId, input.by);
    const open = await openProposal(tx, input.organizationId, current);
    if (!open || open.id !== input.proposalId) {
      throw new UseCaseError("proposal_closed", "La propuesta ya no está pendiente", {
        action: "Recarga la página",
      });
    }
    await appendEvent(tx, {
      id: deps.newId(),
      organization_id: input.organizationId,
      type: "policy.proposal_closed",
      actor: { kind: "humano", name: signer },
      invoice_id: null,
      decision_id: null,
      data: { proposal_id: open.id, outcome: "descartada" },
      trace_id: `tr-${deps.newId()}`,
      occurred_at: at,
    });
  });
}

export type ControlsResult =
  | { readonly kind: "guardada"; readonly version: PolicyVersion }
  | { readonly kind: "propuesta"; readonly proposal: PolicyProposal };

/**
 * Lo que hace un interruptor: apagar va directo, con una firma, porque es la emergencia;
 * encender (pagos, decidir, salir del modo de prueba) queda como propuesta para otra persona.
 */
export async function submitControls(
  deps: DecideDeps,
  input: {
    readonly organizationId: Ulid;
    readonly controls: Partial<Controls>;
    readonly signedBy: string | null;
  },
): Promise<ControlsResult> {
  const at = deps.now().toISOString();
  const proposal = await withWriteTransaction(deps.db, async (tx) => {
    const { current, signer } = await authorize(tx, input.organizationId, input.signedBy);
    const controls = ControlsSchema.parse({ ...current.content.controls, ...input.controls });
    const loosenings = controlsLoosenings(current.content.controls, controls);
    if (loosenings.length === 0) return null;
    const open = await openProposal(tx, input.organizationId, current);
    if (open && !open.stale) {
      throw new UseCaseError(
        "proposal_pending",
        `Ya hay un cambio de ${open.proposedBy} esperando la segunda firma`,
        { action: "Apruébalo o descártalo antes de proponer otro" },
      );
    }
    const traceId = `tr-${deps.newId()}`;
    if (open) {
      await appendEvent(tx, {
        id: deps.newId(),
        organization_id: input.organizationId,
        type: "policy.proposal_closed",
        actor: { kind: "humano", name: signer },
        invoice_id: null,
        decision_id: null,
        data: { proposal_id: open.id, outcome: "vencida" },
        trace_id: traceId,
        occurred_at: at,
      });
    }
    const id = deps.newId();
    await appendEvent(tx, {
      id,
      organization_id: input.organizationId,
      type: "policy.proposed",
      actor: { kind: "humano", name: signer },
      invoice_id: null,
      decision_id: null,
      data: { kind: "controles", base_version: current.version, controls, loosenings, note: null },
      trace_id: traceId,
      occurred_at: at,
    });
    const proposed: PolicyProposal = {
      id,
      kind: "controles",
      controls,
      proposedBy: signer,
      proposedAt: at,
      baseVersion: current.version,
      candidate: parsePolicy({ ...current.content, controls }),
      loosenings,
      note: null,
      stale: false,
    };
    return proposed;
  });
  if (proposal) return { kind: "propuesta", proposal };
  return { kind: "guardada", version: await changeControls(deps, input) };
}
