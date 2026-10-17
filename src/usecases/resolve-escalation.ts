import { withWriteTransaction, type Database, type Transaction } from "@/src/db/client";
import { DbError } from "@/src/db/errors";
import {
  appendEvent,
  debitBalance,
  enqueueNotification,
  ensureLedgerPeriod,
  getCurrentPolicy,
  getInvoice,
  getLatestDecision,
  getLatestExtraction,
  getOrganization,
  getPolicyVersion,
  getVendor,
  insertApproval,
  insertDecision,
  listEvents,
  listPriorInvoices,
  reserveBudget,
  transitionInvoice,
} from "@/src/db/repositories";
import {
  ApprovalPayloadSchema,
  canonicalJson,
  formatMoney,
  isPresent,
  maskAccount,
  paymentOrderFor,
  periodKey,
  toUsd,
  type Approval,
  type ApprovalPayload,
  type ChecklistItem,
  type Decision,
  type Invoice,
  type PolicyVersion,
  type Ulid,
  type UlidGenerator,
  type Vendor,
} from "@/src/domain";
import { scheduledDate } from "@/src/engine";
import { checklistFor, quote } from "@/src/explain";
import { signApproval, verifyApproval } from "@/src/session";

import { businessDateOf, engineNow } from "./business-day";
import { notificationsFor } from "./record-decision";

/**
 * Resolución humana de una escalada (invariantes 3 y 8, docs/practicas.md 43 a 48). Solo una
 * persona convierte `escalar` en `pagar`, y el servidor lo verifica todo, nunca la pantalla:
 *
 * 1. Lo que la persona aprueba es un contenido firmado por el servidor: documento, monto,
 *    beneficiario, cuenta y versión de política. Una firma inválida o un contenido que ya no
 *    coincide con la base invalida la aprobación.
 * 2. Quien aprueba debe estar en la lista de aprobadores de la política, y no puede aprobar
 *    una decisión que él mismo produjo al corregir campos.
 * 3. El checklist completo: cada motivo de la escalada reconocido uno por uno.
 * 4. Antes del efecto se revalida: el mismo cobro no se pagó por otra vía, la política sigue
 *    siendo la de la decisión, y presupuesto y saldo alcanzan (UPDATE condicionales).
 * 5. Todo en una transacción: la primera resolución gana, la segunda recibe "ya resuelta".
 *
 * Aprobar crea una decisión nueva `pagar` con actor humano que apunta a la escalada; la
 * escalada queda como estaba (append-only). Rechazar es final.
 */

export type ApprovalErrorCode =
  | "not_found"
  | "already_resolved"
  | "not_approvable"
  | "invalid_signature"
  | "stale_content"
  | "checklist_incomplete"
  | "not_authorized"
  | "self_approval"
  | "duplicate_paid"
  | "budget_exceeded"
  | "insufficient_balance"
  | "reason_required";

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;
  /** Qué puede hacer la persona. */
  readonly action: string;
  constructor(code: ApprovalErrorCode, message: string, action: string) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
    this.action = action;
  }
}

export type ResolutionDeps = {
  readonly db: Database;
  readonly newId: UlidGenerator;
  readonly now: () => Date;
  readonly timeZone: string;
  /** Día de negocio fijo (la demo usa el del dataset). */
  readonly businessDate?: string;
  /** `APPROVAL_SIGNING_SECRET`. */
  readonly signingSecret: string;
};

/** Lo que la pantalla ofrece firmar, y si se puede aprobar o solo rechazar. */
export type ApprovalOffer = {
  readonly payload: ApprovalPayload;
  readonly signature: string;
  /** Lo que la persona debe reconocer, uno por uno, para aprobar. */
  readonly checklist: readonly ChecklistItem[];
  /** Por qué no se puede aprobar (solo rechazar), o null si se puede. */
  readonly blocked: string | null;
  /** El bloqueo se resuelve reevaluando: cambió la política o venció la espera. */
  readonly needsReevaluation: boolean;
};

type Escalation = {
  readonly invoice: Invoice;
  readonly decision: Decision;
  readonly vendor: Vendor | null;
  readonly policy: PolicyVersion;
  readonly payload: ApprovalPayload;
};

/** La escalada vigente de una factura, o la razón por la que no hay nada que resolver. */
async function loadEscalation(
  db: Database,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<Escalation> {
  const invoice = await getInvoice(db, organizationId, invoiceId).catch((error: unknown) => {
    if (error instanceof DbError && error.code === "not_found") {
      throw new ApprovalError("not_found", "La factura no existe", "Vuelve a pendientes");
    }
    throw error;
  });
  const decision = await getLatestDecision(db, organizationId, invoiceId);
  if (invoice.status !== "esperando_aprobacion" || decision?.verdict !== "escalar") {
    throw new ApprovalError(
      "already_resolved",
      "Esta factura ya no espera una decisión",
      "Recarga la página para ver cómo quedó",
    );
  }
  const [vendor, policy] = await Promise.all([
    decision.vendor_id ? getVendor(db, organizationId, decision.vendor_id) : null,
    getPolicyVersion(db, organizationId, decision.policy_version_id),
  ]);
  return {
    invoice,
    decision,
    vendor,
    policy,
    payload: {
      invoice_id: invoice.id,
      decision_id: decision.id,
      document_hash: invoice.document_hash,
      amount: decision.amount,
      vendor_id: vendor?.id ?? null,
      account_masked: vendor ? maskAccount(vendor.account.account_number) : null,
      policy_version_id: policy.id,
      policy_hash: policy.content_hash,
    },
  };
}

type Blocker = { readonly message: string; readonly reevaluate: boolean };

/** Por qué una escalada no se puede aprobar, o null si sí. Rechazar siempre se puede. */
async function approvalBlocker(
  db: Database,
  escalation: Escalation,
  now: Date,
): Promise<Blocker | null> {
  const { invoice, decision, vendor, policy } = escalation;
  if (!vendor) {
    return {
      message:
        "El beneficiario no está en la lista de vendors: primero hay que darlo de alta. Mientras tanto, solo se puede rechazar.",
      reevaluate: false,
    };
  }
  if (!decision.amount) {
    return {
      message:
        "No hay un monto leído que pagar: hay que corregir los campos o reprocesar. Mientras tanto, solo se puede rechazar.",
      reevaluate: false,
    };
  }
  if (
    invoice.approval_expires_at !== null &&
    Date.parse(invoice.approval_expires_at) < now.getTime()
  ) {
    return {
      message: "La espera de aprobación venció: hay que reevaluarla con la política vigente.",
      reevaluate: true,
    };
  }
  const current = await getCurrentPolicy(db, invoice.organization_id);
  if (current?.id !== policy.id) {
    return {
      message: "La política cambió desde esta decisión: hay que reevaluarla con la vigente.",
      reevaluate: true,
    };
  }
  return null;
}

/** Lo que la pantalla muestra para resolver una escalada, firmado por el servidor. */
export async function approvalOffer(
  deps: Pick<ResolutionDeps, "db" | "signingSecret" | "now">,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<ApprovalOffer | null> {
  const escalation = await loadEscalation(deps.db, organizationId, invoiceId).catch(
    (error: unknown) => {
      if (error instanceof ApprovalError) return null;
      throw error;
    },
  );
  if (!escalation) return null;
  const blocker = await approvalBlocker(deps.db, escalation, deps.now());
  return {
    payload: escalation.payload,
    signature: signApproval(escalation.payload, deps.signingSecret),
    checklist: checklistFor(escalation.decision.findings),
    blocked: blocker?.message ?? null,
    needsReevaluation: blocker?.reevaluate ?? false,
  };
}

export type ResolutionInput = {
  readonly organizationId: Ulid;
  readonly invoiceId: Ulid;
  /** El contenido tal como volvió del formulario: no se confía en él hasta verificarlo. */
  readonly payload: unknown;
  readonly signature: string;
  /** Aprobador de la cookie verificada; null si no eligió. */
  readonly approver: string | null;
  readonly traceId?: string;
};

/**
 * Comprobaciones comunes a aprobar y rechazar: contenido firmado y vigente, y aprobador
 * autorizado. Devuelve la escalada fresca desde la base.
 */
async function verifiedEscalation(
  deps: ResolutionDeps,
  input: ResolutionInput,
): Promise<{ escalation: Escalation; approver: string }> {
  const parsed = ApprovalPayloadSchema.safeParse(input.payload);
  if (!parsed.success || !verifyApproval(parsed.data, input.signature, deps.signingSecret)) {
    throw new ApprovalError(
      "invalid_signature",
      "El contenido a aprobar no tiene una firma válida",
      "Recarga la página y revisa la factura de nuevo",
    );
  }
  const escalation = await loadEscalation(deps.db, input.organizationId, input.invoiceId);
  if (canonicalJson(escalation.payload) !== canonicalJson(parsed.data)) {
    throw new ApprovalError(
      "stale_content",
      "La factura cambió desde que la revisaste",
      "Recarga la página y vuelve a revisar el contenido antes de resolver",
    );
  }
  const current = await getCurrentPolicy(deps.db, input.organizationId);
  if (input.approver === null || !current?.content.protected.approvers.includes(input.approver)) {
    throw new ApprovalError(
      "not_authorized",
      "Quien resuelve no está en la lista de aprobadores de la política",
      "Elige un aprobador de la lista",
    );
  }
  return { escalation, approver: input.approver };
}

function businessDay(deps: ResolutionDeps): string {
  return deps.businessDate ?? businessDateOf(deps.now(), deps.timeZone);
}

/** Algún cobro igual (mismo archivo o misma llave semántica) ya se pagó o se aprobó. */
async function alreadyPaid(tx: Transaction, invoice: Invoice): Promise<boolean> {
  const prior = await listPriorInvoices(tx, invoice.organization_id, {
    vendorId: null,
    semanticKey: invoice.semantic_key,
    documentHash: invoice.document_hash,
    excludeInvoiceId: invoice.id,
  });
  return prior.some((p) => p.outcome === "pagar" || p.outcome === "aprobada");
}

export type ApprovalResult = {
  readonly invoice: Invoice;
  readonly decision: Decision;
  readonly approval: Approval;
};

/**
 * Quiénes corrigieron campos de la factura, leído de la bitácora (append-only). Ninguno puede
 * aprobarla (cuatro ojos, D17). No basta con el actor de la última decisión: una reevaluación
 * posterior, por el botón o por el replay de una política, la decide de nuevo el agente.
 */
async function correctorsOf(
  db: Database,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<Set<string>> {
  const events = await listEvents(db, organizationId, {
    invoiceId,
    type: "invoice.corrected",
    limit: 500,
  });
  return new Set(events.flatMap((e) => (e.actor.kind === "humano" ? [e.actor.name] : [])));
}

export async function approveEscalation(
  deps: ResolutionDeps,
  input: ResolutionInput & { readonly checkedCodes: readonly string[] },
): Promise<ApprovalResult> {
  const { escalation, approver } = await verifiedEscalation(deps, input);
  const { invoice, decision, vendor, policy, payload } = escalation;
  const now = deps.now();
  const blocker = await approvalBlocker(deps.db, escalation, now);
  if (blocker || !vendor || !decision.amount) {
    throw new ApprovalError(
      "not_approvable",
      blocker?.message ?? "No se puede aprobar",
      blocker?.reevaluate ? "Reevalúala con la política vigente" : "Rechaza con motivo",
    );
  }
  const required = checklistFor(decision.findings);
  const checked = new Set(input.checkedCodes);
  if (!required.every((item) => checked.has(item.code))) {
    throw new ApprovalError(
      "checklist_incomplete",
      "Falta reconocer motivos del checklist",
      "Marca cada punto después de verificarlo",
    );
  }
  if ((await correctorsOf(deps.db, invoice.organization_id, invoice.id)).has(approver)) {
    throw new ApprovalError(
      "self_approval",
      "No puedes aprobar una factura en la que tú corregiste campos",
      "Pide a otra persona de la lista de aprobadores que la revise",
    );
  }

  const organization = await getOrganization(deps.db, input.organizationId);
  const extraction = (await getLatestExtraction(deps.db, invoice.organization_id, invoice.id))
    ?.record.extraction;
  const dueDate =
    extraction?.kind === "invoice" && isPresent(extraction.fields.due_date)
      ? extraction.fields.due_date.value
      : null;
  const content = policy.content;
  const today = businessDay(deps);
  const scheduledFor = scheduledDate(
    dueDate,
    today,
    content.rules.due_date_window.schedule_days_before,
  );
  const amount = decision.amount;
  const amountUsd = toUsd(amount, organization.fx);
  const at = now.toISOString();
  const dryRun = content.controls.dry_run;
  const traceId = input.traceId ?? `tr-${deps.newId()}`;
  const acknowledged = required.map((item) => item.code);

  const approved: Decision = {
    ...decision,
    id: deps.newId(),
    verdict: "pagar",
    findings: [],
    explanation: [
      `Se paga ${formatMoney(amount)} a ${quote(vendor.name)} por aprobación de ${quote(approver)}.`,
      `Reconoció: ${acknowledged.join(", ")}.`,
      dryRun
        ? "Modo de prueba: sin orden de pago y sin comprometer presupuesto ni saldo."
        : `Pago programado para el ${scheduledFor}.`,
    ].join("\n"),
    summary: null,
    scheduled_for: scheduledFor,
    payment_order: dryRun
      ? null
      : paymentOrderFor({
          vendor,
          amount,
          policy: content,
          scheduledFor,
          reference: invoice.reference,
        }),
    amount_usd: { amount: amountUsd.amount, currency: "USD" },
    previous_decision_id: decision.id,
    dry_run: dryRun,
    actor: { kind: "humano", name: approver },
    cost_usd_micros: 0,
    latency_ms: 0,
    decided_at: at,
  };
  const approval: Approval = {
    id: deps.newId(),
    organization_id: invoice.organization_id,
    invoice_id: invoice.id,
    decision_id: decision.id,
    outcome: "aprobada",
    approver,
    checklist: required.map((item) => ({ ...item, checked: true })),
    reason: null,
    payload,
    signature: input.signature,
    // La consume en el acto la decisión que crea: una aprobación nunca se reutiliza.
    consumed_at: at,
    created_at: at,
  };

  try {
    await withWriteTransaction(deps.db, async (tx) => {
      const current = await getCurrentPolicy(tx, invoice.organization_id);
      if (current?.id !== policy.id) {
        throw new ApprovalError(
          "stale_content",
          "La política cambió mientras resolvías",
          "Recarga y reevalúa",
        );
      }
      await transitionInvoice(
        tx,
        invoice.organization_id,
        invoice.id,
        "esperando_aprobacion",
        "aprobada",
        at,
        {
          approval_expires_at: null,
        },
      );
      await insertApproval(tx, approval);
      if (await alreadyPaid(tx, invoice)) {
        throw new ApprovalError(
          "duplicate_paid",
          "Este mismo cobro ya se pagó o se aprobó en otra factura",
          "Rechaza esta como duplicada",
        );
      }
      if (!dryRun) {
        const { budget } = content.limits;
        const period = periodKey(engineNow(today), budget.period);
        await ensureLedgerPeriod(
          tx,
          invoice.organization_id,
          period,
          budget.currency,
          budget.amount,
          at,
        );
        if (amountUsd.amount > 0) {
          await reserveBudget(
            tx,
            invoice.organization_id,
            period,
            budget.currency,
            amountUsd.amount,
            at,
          );
        }
        await debitBalance(tx, invoice.organization_id, amount.currency, amount.amount, at);
      }
      await insertDecision(tx, approved);
      await appendEvent(tx, {
        id: deps.newId(),
        organization_id: invoice.organization_id,
        type: "invoice.approved",
        actor: { kind: "humano", name: approver },
        invoice_id: invoice.id,
        decision_id: approved.id,
        data: {
          approval_id: approval.id,
          previous_decision_id: decision.id,
          acknowledged,
          signature: input.signature,
          policy_version: policy.version,
          dry_run: dryRun,
        },
        trace_id: traceId,
        occurred_at: at,
      });
      for (const notification of notificationsFor({
        decision: approved,
        invoice,
        channel: invoice.channel,
        newId: deps.newId,
        nowIso: at,
      })) {
        await enqueueNotification(tx, notification);
      }
    });
  } catch (error) {
    throw resolutionError(error);
  }
  return {
    invoice: { ...invoice, status: "aprobada", approval_expires_at: null, updated_at: at },
    decision: approved,
    approval,
  };
}

const MIN_REASON = 5;

export async function rejectEscalation(
  deps: ResolutionDeps,
  input: ResolutionInput & { readonly reason: string },
): Promise<{ readonly invoice: Invoice; readonly approval: Approval }> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) {
    throw new ApprovalError(
      "reason_required",
      "El rechazo necesita un motivo",
      "Escribe en una frase por qué se rechaza",
    );
  }
  const { escalation, approver } = await verifiedEscalation(deps, input);
  const { invoice, decision, payload } = escalation;
  const at = deps.now().toISOString();
  const approval: Approval = {
    id: deps.newId(),
    organization_id: invoice.organization_id,
    invoice_id: invoice.id,
    decision_id: decision.id,
    outcome: "rechazada",
    approver,
    checklist: [],
    reason: reason.slice(0, 1000),
    payload,
    signature: input.signature,
    consumed_at: null,
    created_at: at,
  };
  try {
    await withWriteTransaction(deps.db, async (tx) => {
      await transitionInvoice(
        tx,
        invoice.organization_id,
        invoice.id,
        "esperando_aprobacion",
        "rechazada",
        at,
        {
          approval_expires_at: null,
        },
      );
      await insertApproval(tx, approval);
      await appendEvent(tx, {
        id: deps.newId(),
        organization_id: invoice.organization_id,
        type: "invoice.rejected",
        actor: { kind: "humano", name: approver },
        invoice_id: invoice.id,
        decision_id: decision.id,
        data: { approval_id: approval.id, reason: approval.reason },
        trace_id: input.traceId ?? `tr-${deps.newId()}`,
        occurred_at: at,
      });
    });
  } catch (error) {
    throw resolutionError(error);
  }
  return {
    invoice: { ...invoice, status: "rechazada", approval_expires_at: null, updated_at: at },
    approval,
  };
}

/** Traduce los errores de la base a errores de resolución con acción sugerida. */
function resolutionError(error: unknown): unknown {
  if (error instanceof ApprovalError) return error;
  if (error instanceof DbError) {
    switch (error.code) {
      case "stale_state":
      case "conflict":
        return new ApprovalError(
          "already_resolved",
          "Otra persona resolvió esta factura primero",
          "Recarga la página para ver cómo quedó",
        );
      case "budget_exceeded":
        return new ApprovalError(
          "budget_exceeded",
          "El presupuesto del periodo no alcanza para este pago",
          "Rechaza o espera al próximo periodo; ajustar el presupuesto es un cambio de política",
        );
      case "insufficient_balance":
        return new ApprovalError(
          "insufficient_balance",
          "El saldo en esa moneda no alcanza para este pago",
          "Rechaza o espera a que haya saldo",
        );
      default:
        return error;
    }
  }
  return error;
}
