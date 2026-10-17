import { withWriteTransaction, type Database } from "@/src/db/client";
import { DbError } from "@/src/db/errors";
import {
  appendEvent,
  ensureLedgerPeriod,
  getCurrentPolicy,
  getLedgerPeriod,
  listBalances,
  listPriorInvoices,
  listTelegramChats,
  transitionInvoice,
} from "@/src/db/repositories";
import {
  EXTRACTED_FIELD_NAMES,
  isPresent,
  isSupportedCurrency,
  money,
  paymentOrderFor,
  periodKey,
  semanticKey,
  toUsd,
  type Actor,
  type AuditEvent,
  type Decision,
  type EventType,
  type ExtractedFieldName,
  type Extraction,
  type ExtractionRecord,
  type FieldSource,
  type Finding,
  type Invoice,
  type Money,
  type LedgerPeriod,
  type Organization,
  type PaymentOrderDraft,
  type Policy,
  type PolicyVersion,
  type Ulid,
  type UlidGenerator,
  type Vendor,
} from "@/src/domain";
import {
  decidingFinding,
  evaluate,
  type Evaluation,
  type EvaluationContext,
  type PayeeMatch,
  type VerificationReport,
} from "@/src/engine";
import { explainDecision } from "@/src/explain";
import { IngestError, ModelError } from "@/src/extraction";

import { businessDateOf, engineNow } from "./business-day";
import { UseCaseError } from "./errors";
import {
  DecisionRaceError,
  approvalExpiry,
  notificationsFor,
  recordDecision,
  statusFor,
  type DecisionRecord,
  type Reservation,
} from "./record-decision";

/**
 * El tramo común a toda decisión del agente: con una lectura ya hecha (del modelo, o
 * corregida por una persona) y el beneficiario resuelto, evaluar las reglas con datos
 * frescos y registrar la decisión con todo lo que arrastra en una transacción. Lo usan
 * `processInvoice` y la corrección o reevaluación de una factura.
 *
 * También vive aquí el camino de error: una etapa que falla deja la factura en `escalar`
 * con el hallazgo `processing_error`, o en `fallida` si ni eso se puede escribir.
 */

export type DecideDeps = {
  readonly db: Database;
  readonly newId: UlidGenerator;
  readonly now: () => Date;
  /** Zona de la empresa para calcular el día de negocio. */
  readonly timeZone: string;
  /** Día de negocio fijo (`YYYY-MM-DD`); la demo usa el del dataset. */
  readonly businessDate?: string;
};

/** Lo que el motor necesita de la lectura: la extracción, su verificación y su costo. */
export type Reading = {
  readonly record: ExtractionRecord;
  readonly verification: VerificationReport;
  readonly cost_usd_micros: number;
  readonly latency_ms: number;
};

/** Cómo se reintenta una factura fallida: la misma entrega vuelve a procesarse. */
export const RETRY_ACTION = "Vuelve a enviar la misma factura por el mismo canal para reintentarla";

// ---------------------------------------------------------------------------
// Etapas. Cada error dentro de una etapa sale envuelto con el nombre de la etapa, que es
// lo que la persona lee en el hallazgo.
// ---------------------------------------------------------------------------

export const STAGE_LABELS = {
  normalize: "normalización del documento",
  read: "lectura y verificación",
  resolve: "resolución del beneficiario",
  evaluate: "evaluación de reglas",
  record: "registro de la decisión",
} as const;
export type Stage = keyof typeof STAGE_LABELS;

export class StageFailure extends Error {
  readonly stage: Stage;
  constructor(stage: Stage, cause: unknown) {
    super(`Falló la etapa ${stage}`, { cause });
    this.name = "StageFailure";
    this.stage = stage;
  }
}

export async function inStage<T>(stage: Stage, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw error instanceof StageFailure ? error : new StageFailure(stage, error);
  }
}

/** Código corto y mensaje seguro de un error. Un error desconocido no expone su texto. */
export function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof IngestError) return { code: error.code, message: error.message };
  if (error instanceof DbError) return { code: error.code, message: "error de la base de datos" };
  if (error instanceof ModelError) return { code: error.code, message: "error del modelo" };
  if (error instanceof UseCaseError) return { code: error.code, message: error.message };
  return { code: "unexpected", message: "error inesperado" };
}

/** Evento de bitácora de una factura. Por defecto el actor es el agente. */
export function auditEvent(
  deps: Pick<DecideDeps, "newId">,
  input: {
    readonly type: EventType;
    readonly actor?: Actor;
    readonly invoice: Invoice;
    readonly decisionId?: Ulid;
    readonly data: Record<string, unknown>;
    readonly traceId: string;
    readonly at: string;
  },
): AuditEvent {
  return {
    id: deps.newId(),
    organization_id: input.invoice.organization_id,
    type: input.type,
    actor: input.actor ?? { kind: "agente" },
    invoice_id: input.invoice.id,
    decision_id: input.decisionId ?? null,
    data: input.data,
    trace_id: input.traceId,
    occurred_at: input.at,
  };
}

export type DecideArgs = {
  readonly organization: Organization;
  readonly invoice: Invoice;
  readonly reading: Reading;
  readonly payee: PayeeMatch;
  /** Eventos de las etapas previas (normalizada, leída, corregida), que van con la decisión. */
  readonly pipelineEvents: readonly AuditEvent[];
  readonly traceId: string;
  /** Quién decide: el agente, o la persona cuya corrección se evalúa. */
  readonly actor: Actor;
  /** Decisión que esta reemplaza, si es una reevaluación. */
  readonly previousDecisionId: Ulid | null;
  /** Texto y páginas del documento recién normalizado; null si la factura ya los tiene. */
  readonly documentPatch: {
    readonly text: string | null;
    readonly page_keys: readonly string[];
  } | null;
};

export type Decided = {
  readonly invoice: Invoice;
  readonly decision: Decision;
  readonly evaluation: Evaluation;
};

/**
 * Evalúa y registra. La factura debe estar en `procesando`. Los errores salen envueltos en
 * `StageFailure` con la etapa, para que quien llama escale con el hallazgo del error.
 */
export async function decideAndRecord(deps: DecideDeps, args: DecideArgs): Promise<Decided> {
  const today = deps.businessDate ?? businessDateOf(deps.now(), deps.timeZone);
  const telegramLinked = await hasTelegramChat(deps, args.organization.id);
  // Lo evaluado puede cambiar antes de escribir: otra decisión gastó el presupuesto, otra
  // factura del mismo cobro se registró, o cambió la política. Cada intento relee todo, así
  // que el siguiente ya lo ve (el motor frena por presupuesto o duplicado, o aplica la
  // política nueva). Si se pierde una y otra vez, la factura escala por error de registro.
  for (let attempt = 1; ; attempt++) {
    const { context, policyVersion } = await inStage("evaluate", () =>
      evaluationContext(deps, { ...args, today }),
    );
    const evaluation = await inStage("evaluate", () => evaluate(context));
    const record = await inStage("record", () =>
      buildRecord(deps, { ...args, policyVersion, context, evaluation, telegramLinked }),
    );
    try {
      await inStage("record", () => recordDecision(deps.db, record));
    } catch (error) {
      const cause = error instanceof StageFailure ? error.cause : error;
      if (isLostRace(cause) && attempt < MAX_RECORD_ATTEMPTS) continue;
      throw error;
    }
    return { invoice: savedInvoice(record), decision: record.decision, evaluation };
  }
}

/**
 * La empresa tiene un chat de Telegram conectado (D24): sus decisiones importantes también
 * se avisan por ahí. Si la consulta falla, la decisión sigue y el aviso queda en pantalla.
 */
async function hasTelegramChat(deps: DecideDeps, organizationId: Ulid): Promise<boolean> {
  return listTelegramChats(deps.db, organizationId)
    .then((chats) => chats.length > 0)
    .catch(() => false);
}

/** Intentos de evaluar y registrar antes de rendirse a otras decisiones simultáneas. */
const MAX_RECORD_ATTEMPTS = 3;

/** Verdadero si el registro falló porque otra escritura cambió lo que se había evaluado. */
function isLostRace(error: unknown): boolean {
  if (error instanceof DecisionRaceError) return true;
  return (
    error instanceof DbError &&
    (error.code === "budget_exceeded" || error.code === "insufficient_balance")
  );
}

/** La factura tal como quedó tras registrar la decisión, sin volver a leerla. */
export function savedInvoice(record: DecisionRecord): Invoice {
  const { invoice, decision, patch } = record;
  return {
    ...invoice,
    status: statusFor(decision.verdict),
    text: patch.text === undefined ? invoice.text : patch.text,
    page_keys: patch.page_keys ?? invoice.page_keys,
    semantic_key: patch.semantic_key === undefined ? invoice.semantic_key : patch.semantic_key,
    approval_expires_at:
      patch.approval_expires_at === undefined
        ? invoice.approval_expires_at
        : patch.approval_expires_at,
    updated_at: decision.decided_at,
  };
}

/** Llave semántica del cobro. Con el vendor resuelto se usa su nombre registrado. */
function semanticKeyOf(extraction: Extraction, payee: PayeeMatch): string | null {
  if (extraction.kind !== "invoice") return null;
  const { fields } = extraction;
  if (!isSupportedCurrency(fields.currency.value)) return null;
  try {
    return semanticKey({
      payeeName: payee.kind === "matched" ? payee.vendor.name : fields.payee_name.value,
      invoiceNumber: fields.invoice_number.value,
      amount: fields.total.value,
      currency: fields.currency.value,
    });
  } catch {
    // Un nombre o número que quedan vacíos al normalizar no identifican el cobro.
    return null;
  }
}

/**
 * Todo lo que el motor necesita, leído de la base en cada intento, incluida la política
 * vigente: el interruptor de pagos se consulta en cada decisión, no al empezar. El periodo
 * de presupuesto del mes se crea si falta.
 */
async function evaluationContext(
  deps: DecideDeps,
  args: DecideArgs & { readonly today: string },
): Promise<{ readonly context: EvaluationContext; readonly policyVersion: PolicyVersion }> {
  const policyVersion = await getCurrentPolicy(deps.db, args.organization.id);
  if (!policyVersion) {
    throw new UseCaseError("policy_missing", "La empresa se quedó sin política vigente", {
      action: "Guarda una política en la pantalla de Reglas y reintenta",
    });
  }
  const { budget } = policyVersion.content.limits;
  await withWriteTransaction(deps.db, (tx) =>
    ensureLedgerPeriod(
      tx,
      args.organization.id,
      periodKey(engineNow(args.today), budget.period),
      budget.currency,
      budget.amount,
      deps.now().toISOString(),
    ),
  );
  return {
    policyVersion,
    context: await readEvaluationContext(deps, { ...args, policy: policyVersion.content }),
  };
}

/**
 * El contexto del motor para una política dada, sin escribir nada: lo usa la decisión real
 * (con la vigente) y la vista previa de un cambio de política (con la candidata). En la vista
 * previa el presupuesto del periodo se lee con el límite de la candidata.
 */
export async function readEvaluationContext(
  deps: Pick<DecideDeps, "db" | "now">,
  args: {
    readonly organization: Organization;
    readonly invoice: Invoice;
    readonly reading: Reading;
    readonly payee: PayeeMatch;
    readonly today: string;
    readonly policy: Policy;
    /**
     * Solo en la vista previa: si el periodo todavía no existe, se evalúa como recién creado.
     * En una decisión real un periodo ausente es un artefacto que falta y el motor frena.
     */
    readonly assumeNewPeriod?: boolean;
  },
): Promise<EvaluationContext> {
  const { organization, invoice, reading, payee, policy } = args;
  const now = engineNow(args.today);
  const { budget } = policy.limits;
  const period = periodKey(now, budget.period);
  const key = semanticKeyOf(reading.record.extraction, payee);
  const [stored, balances, prior] = await Promise.all([
    getLedgerPeriod(deps.db, organization.id, period, budget.currency),
    listBalances(deps.db, organization.id),
    listPriorInvoices(deps.db, organization.id, {
      vendorId: payee.kind === "matched" ? payee.vendor.id : null,
      semanticKey: key,
      documentHash: invoice.document_hash,
      excludeInvoiceId: invoice.id,
    }),
  ]);
  // El límite que manda es el de la política que se evalúa; lo comprometido es lo de la base.
  const ledger: LedgerPeriod | null = stored
    ? { ...stored, limit: budget.amount }
    : !args.assumeNewPeriod
      ? null
      : {
          organization_id: organization.id,
          period_key: period,
          currency: budget.currency,
          limit: budget.amount,
          committed: 0,
          updated_at: deps.now().toISOString(),
        };
  return {
    extraction: reading.record.extraction,
    verification: reading.verification,
    payee,
    policy,
    fx: organization.fx,
    ledger,
    balances,
    prior,
    invoice_id: invoice.id,
    document_hash: invoice.document_hash,
    semantic_key: key,
    now,
  };
}

/** Monto leído en su moneda, si está soportada. */
function amountOf(extraction: Extraction): Money | null {
  if (extraction.kind !== "invoice") return null;
  const { currency, total } = extraction.fields;
  return isSupportedCurrency(currency.value) ? money(total.value, currency.value) : null;
}

/** De qué fuente salió cada campo leído: modelo o persona. */
function fieldSources(extraction: Extraction): Partial<Record<ExtractedFieldName, FieldSource>> {
  if (extraction.kind !== "invoice") return {};
  const out: Partial<Record<ExtractedFieldName, FieldSource>> = {};
  for (const name of EXTRACTED_FIELD_NAMES) {
    const field = extraction.fields[name];
    if (isPresent(field)) out[name] = field.source;
  }
  return out;
}

/** Arma la decisión y todo lo que se escribe con ella, sin tocar la base. */
function buildRecord(
  deps: DecideDeps,
  args: DecideArgs & {
    readonly policyVersion: PolicyVersion;
    readonly context: EvaluationContext;
    readonly evaluation: Evaluation;
    readonly telegramLinked: boolean;
  },
): DecisionRecord {
  const { organization, policyVersion, invoice, reading, payee, context, evaluation } = args;
  const read = reading;
  const policy = policyVersion.content;
  const duplicateWindowDays = policy.rules.duplicate_invoice.window_days;
  const extraction = read.record.extraction;
  const now = deps.now();
  const at = now.toISOString();
  const dryRun = policy.controls.dry_run;
  const amount = amountOf(extraction);
  const amountUsd = amount ? toUsd(amount, organization.fx) : null;
  const vendor: Vendor | null = payee.kind === "matched" ? payee.vendor : null;
  const scheduledFor = evaluation.scheduled_for;

  let reservation: Reservation | null = null;
  let paymentOrder: PaymentOrderDraft | null = null;
  if (evaluation.verdict === "pagar") {
    // Defensa en profundidad (invariante 11): el motor nunca paga sin vendor ni monto, pero
    // si ocurriera, no hay de dónde sacar la cuenta y la factura escala por error.
    if (!vendor || !amount || !amountUsd || !scheduledFor || !context.ledger) {
      throw new Error("pagar sin vendor, monto, fecha o presupuesto");
    }
    if (!dryRun) {
      paymentOrder = paymentOrderFor({
        vendor,
        amount,
        policy,
        scheduledFor,
        reference: invoice.reference,
      });
      reservation = {
        periodKey: context.ledger.period_key,
        budgetCurrency: "USD",
        usdCents: amountUsd.amount,
        currency: amount.currency,
        amount: amount.amount,
      };
    }
  }

  const payeeName =
    vendor?.name ?? (extraction.kind === "invoice" ? extraction.fields.payee_name.value : null);
  const decision: Decision = {
    id: deps.newId(),
    organization_id: organization.id,
    invoice_id: invoice.id,
    verdict: evaluation.verdict,
    findings: [...evaluation.findings],
    explanation: explainDecision({
      evaluation,
      amount,
      payeeName,
      policyVersion: policyVersion.version,
    }),
    summary: null,
    scheduled_for: scheduledFor,
    payment_order: paymentOrder,
    amount,
    amount_usd: amountUsd ? { amount: amountUsd.amount, currency: "USD" } : null,
    vendor_id: vendor?.id ?? null,
    policy_version_id: policyVersion.id,
    policy_hash: policyVersion.content_hash,
    document_hash: invoice.document_hash,
    extraction_hash: read.record.extraction_hash,
    field_sources: fieldSources(extraction),
    previous_decision_id: args.previousDecisionId,
    dry_run: dryRun,
    actor: args.actor,
    cost_usd_micros: read.cost_usd_micros,
    latency_ms: read.latency_ms,
    decided_at: at,
  };

  const deciding = decidingFinding(evaluation);
  const decidedEvent = auditEvent(deps, {
    type: evaluation.verdict === "escalar" ? "invoice.escalated" : "invoice.decided",
    actor: args.actor,
    invoice,
    decisionId: decision.id,
    data: {
      verdict: decision.verdict,
      deciding_rule: deciding?.code ?? null,
      findings: decision.findings.map((f) => f.code),
      rule_log: evaluation.log.map((l) => ({ code: l.code, outcome: l.outcome })),
      policy_version: policyVersion.version,
      policy_hash: policyVersion.content_hash,
      dry_run: dryRun,
      payment_order: paymentOrder !== null,
    },
    traceId: args.traceId,
    at,
  });

  return {
    invoice,
    decision,
    duplicateGuard:
      decision.verdict === "pagar" && context.semantic_key !== null
        ? {
            semanticKey: context.semantic_key,
            since: new Date(context.now.getTime() - duplicateWindowDays * 86_400_000).toISOString(),
          }
        : null,
    patch: {
      ...(args.documentPatch
        ? { text: args.documentPatch.text, page_keys: [...args.documentPatch.page_keys] }
        : {}),
      semantic_key: context.semantic_key,
      approval_expires_at: approvalExpiry(decision.verdict, now),
    },
    extraction: {
      id: deps.newId(),
      organization_id: organization.id,
      invoice_id: invoice.id,
      document_hash: invoice.document_hash,
      record: read.record,
      created_at: at,
    },
    reservation,
    events: [...args.pipelineEvents, decidedEvent],
    notifications: notificationsFor({
      decision,
      invoice,
      telegramLinked: args.telegramLinked,
      newId: deps.newId,
      nowIso: at,
    }),
  };
}

// ---------------------------------------------------------------------------
// Camino de error: la factura ya registrada escala con el error como motivo.
// ---------------------------------------------------------------------------

export async function escalateOnFailure(
  deps: DecideDeps,
  args: {
    readonly organization: Organization;
    readonly policyVersion: PolicyVersion;
    readonly invoice: Invoice;
    readonly failure: StageFailure;
    readonly traceId: string;
  },
): Promise<{ readonly invoice: Invoice; readonly decision: Decision }> {
  const { organization, invoice, failure, traceId } = args;
  // La decisión se registra con la política vigente: la del inicio pudo cambiar mientras tanto.
  const policyVersion =
    (await getCurrentPolicy(deps.db, organization.id).catch(() => null)) ?? args.policyVersion;
  const error = describeError(failure.cause);
  const telegramLinked = await hasTelegramChat(deps, organization.id);
  const now = deps.now();
  const at = now.toISOString();
  const finding: Finding = {
    code: "processing_error",
    severity: "block",
    action: "escalar",
    observed: `${STAGE_LABELS[failure.stage]} (${error.code})`,
    threshold: "un procesamiento completo",
    evidence: null,
    field: null,
    message: `La factura no se pudo procesar por completo: ${error.message}`,
  };
  const decision: Decision = {
    id: deps.newId(),
    organization_id: organization.id,
    invoice_id: invoice.id,
    verdict: "escalar",
    findings: [finding],
    explanation: explainDecision({
      evaluation: { verdict: "escalar", findings: [finding], log: [], scheduled_for: null },
      amount: null,
      payeeName: null,
      policyVersion: policyVersion.version,
    }),
    summary: null,
    scheduled_for: null,
    payment_order: null,
    amount: null,
    amount_usd: null,
    vendor_id: null,
    policy_version_id: policyVersion.id,
    policy_hash: policyVersion.content_hash,
    document_hash: invoice.document_hash,
    extraction_hash: null,
    field_sources: {},
    previous_decision_id: null,
    dry_run: policyVersion.content.controls.dry_run,
    actor: { kind: "agente" },
    cost_usd_micros: 0,
    latency_ms: 0,
    decided_at: at,
  };
  const errorData = { stage: failure.stage, code: error.code };
  const record: DecisionRecord = {
    invoice,
    decision,
    duplicateGuard: null,
    patch: { approval_expires_at: approvalExpiry("escalar", now) },
    extraction: null,
    reservation: null,
    events: [
      auditEvent(deps, {
        type: "invoice.escalated",
        invoice,
        decisionId: decision.id,
        data: {
          verdict: "escalar",
          deciding_rule: "processing_error",
          findings: ["processing_error"],
          error: errorData,
          policy_version: policyVersion.version,
          policy_hash: policyVersion.content_hash,
        },
        traceId,
        at,
      }),
    ],
    notifications: notificationsFor({
      decision,
      invoice,
      telegramLinked,
      newId: deps.newId,
      nowIso: at,
    }),
  };
  try {
    await recordDecision(deps.db, record);
  } catch (recordError) {
    await markFailed(deps, { invoice, errorData, traceId, at }, recordError);
    throw new UseCaseError("record_failed", "La factura quedó marcada como fallida", {
      action: RETRY_ACTION,
      retryable: true,
      cause: failure,
    });
  }
  return { invoice: savedInvoice(record), decision };
}

/**
 * Último recurso: ni la decisión de escalado se pudo escribir. La factura pasa a `fallida`,
 * un estado del que solo se sale reintentando. Si tampoco eso se puede, el error sube.
 */
async function markFailed(
  deps: DecideDeps,
  args: {
    readonly invoice: Invoice;
    readonly errorData: Record<string, unknown>;
    readonly traceId: string;
    readonly at: string;
  },
  cause: unknown,
): Promise<void> {
  const { invoice, at } = args;
  try {
    await withWriteTransaction(deps.db, async (tx) => {
      await transitionInvoice(tx, invoice.organization_id, invoice.id, "procesando", "fallida", at);
      await appendEvent(
        tx,
        auditEvent(deps, {
          type: "invoice.failed",
          invoice,
          data: { ...args.errorData, record_error: describeError(cause).code },
          traceId: args.traceId,
          at,
        }),
      );
    });
  } catch (error) {
    throw new UseCaseError("record_failed", "No se pudo registrar el resultado de la factura", {
      action: RETRY_ACTION,
      retryable: true,
      cause: error,
    });
  }
}
