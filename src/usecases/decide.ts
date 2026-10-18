import { withWriteTransaction, type Database } from "@/src/db/client";
import { DbError } from "@/src/db/errors";
import {
  ensureLedgerPeriod,
  getCurrentPolicy,
  getLedgerPeriod,
  listBalances,
  listPriorInvoices,
  listTelegramChats,
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
import { StageFailure, inStage } from "./stage";

/**
 * El tramo común a toda decisión del agente: con una lectura ya hecha (del modelo, o
 * corregida por una persona) y el beneficiario resuelto, evaluar las reglas con datos
 * frescos y registrar la decisión con todo lo que arrastra en una transacción. Lo usan
 * `processInvoice` y la corrección o reevaluación de una factura.
 *
 * El camino de error vive en escalate-on-failure.ts y las etapas en stage.ts.
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
export async function hasTelegramChat(deps: DecideDeps, organizationId: Ulid): Promise<boolean> {
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

/** Fecha de emisión leída (ISO), para reglas de historial por periodo. Null si falta o no es factura. */
function issueDateOf(extraction: Extraction): string | null {
  if (extraction.kind !== "invoice") return null;
  const field = extraction.fields.issue_date;
  return isPresent(field) ? field.value : null;
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

type RecordArgs = DecideArgs & {
  readonly policyVersion: PolicyVersion;
  readonly context: EvaluationContext;
  readonly evaluation: Evaluation;
  readonly telegramLinked: boolean;
};

/** Arma la decisión y todo lo que se escribe con ella, sin tocar la base. */
function buildRecord(deps: DecideDeps, args: RecordArgs): DecisionRecord {
  const { organization, policyVersion, invoice, reading, context } = args;
  const now = deps.now();
  const at = now.toISOString();
  const amount = amountOf(reading.record.extraction);
  const amountUsd = amount ? toUsd(amount, organization.fx) : null;
  const vendor = args.payee.kind === "matched" ? args.payee.vendor : null;
  const { paymentOrder, reservation } = paymentFor(args, { vendor, amount, amountUsd });
  const decision = decisionFrom(deps, args, { vendor, amount, amountUsd, paymentOrder, at });

  return {
    invoice,
    decision,
    duplicateGuard: duplicateGuardFor(decision, context, policyVersion.content),
    patch: {
      ...(args.documentPatch
        ? { text: args.documentPatch.text, page_keys: [...args.documentPatch.page_keys] }
        : {}),
      semantic_key: context.semantic_key,
      issue_date: issueDateOf(reading.record.extraction),
      approval_expires_at: approvalExpiry(decision.verdict, now),
    },
    extraction: {
      id: deps.newId(),
      organization_id: organization.id,
      invoice_id: invoice.id,
      document_hash: invoice.document_hash,
      record: reading.record,
      created_at: at,
    },
    reservation,
    events: [...args.pipelineEvents, decidedEvent(deps, args, decision)],
    notifications: notificationsFor({
      decision,
      invoice,
      telegramLinked: args.telegramLinked,
      newId: deps.newId,
      nowIso: at,
    }),
  };
}

type Amounts = {
  readonly vendor: Vendor | null;
  readonly amount: Money | null;
  readonly amountUsd: Money | null;
};

/**
 * La orden de pago y la reserva de presupuesto de un `pagar`. En modo de prueba no hay
 * ninguna de las dos: la decisión queda registrada sin mover dinero.
 */
function paymentFor(
  args: RecordArgs,
  { vendor, amount, amountUsd }: Amounts,
): { paymentOrder: PaymentOrderDraft | null; reservation: Reservation | null } {
  const { evaluation, context, invoice } = args;
  const policy = args.policyVersion.content;
  if (evaluation.verdict !== "pagar") return { paymentOrder: null, reservation: null };
  const scheduledFor = evaluation.scheduled_for;
  // Defensa en profundidad (invariante 11): el motor nunca paga sin vendor ni monto, pero
  // si ocurriera, no hay de dónde sacar la cuenta y la factura escala por error.
  if (!vendor || !amount || !amountUsd || !scheduledFor || !context.ledger) {
    throw new Error("pagar sin vendor, monto, fecha o presupuesto");
  }
  if (policy.controls.dry_run) return { paymentOrder: null, reservation: null };
  return {
    paymentOrder: paymentOrderFor({
      vendor,
      amount,
      policy,
      scheduledFor,
      reference: invoice.reference,
    }),
    reservation: {
      periodKey: context.ledger.period_key,
      budgetCurrency: "USD",
      usdCents: amountUsd.amount,
      currency: amount.currency,
      amount: amount.amount,
    },
  };
}

/** La decisión con su explicación, la huella de la política y de la lectura, y su costo. */
function decisionFrom(
  deps: Pick<DecideDeps, "newId">,
  args: RecordArgs,
  input: Amounts & { readonly paymentOrder: PaymentOrderDraft | null; readonly at: string },
): Decision {
  const { organization, policyVersion, invoice, reading, evaluation } = args;
  const { vendor, amount, amountUsd } = input;
  const extraction = reading.record.extraction;
  const payeeName =
    vendor?.name ?? (extraction.kind === "invoice" ? extraction.fields.payee_name.value : null);
  return {
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
    scheduled_for: evaluation.scheduled_for,
    payment_order: input.paymentOrder,
    amount,
    amount_usd: amountUsd ? { amount: amountUsd.amount, currency: "USD" } : null,
    vendor_id: vendor?.id ?? null,
    policy_version_id: policyVersion.id,
    policy_hash: policyVersion.content_hash,
    document_hash: invoice.document_hash,
    extraction_hash: reading.record.extraction_hash,
    field_sources: fieldSources(extraction),
    previous_decision_id: args.previousDecisionId,
    dry_run: policyVersion.content.controls.dry_run,
    actor: args.actor,
    cost_usd_micros: reading.cost_usd_micros,
    latency_ms: reading.latency_ms,
    decided_at: input.at,
  };
}

/**
 * Un `pagar` con llave semántica bloquea, al registrarse, otro pago del mismo cobro dentro
 * de la ventana de duplicados.
 */
function duplicateGuardFor(
  decision: Decision,
  context: EvaluationContext,
  policy: Policy,
): DecisionRecord["duplicateGuard"] {
  if (decision.verdict !== "pagar" || context.semantic_key === null) return null;
  const windowMs = policy.rules.duplicate_invoice.window_days * 86_400_000;
  return {
    semanticKey: context.semantic_key,
    since: new Date(context.now.getTime() - windowMs).toISOString(),
  };
}

/** El evento de bitácora de la decisión: veredicto, regla que decide y rastro del motor. */
function decidedEvent(
  deps: Pick<DecideDeps, "newId">,
  args: RecordArgs,
  decision: Decision,
): AuditEvent {
  const { evaluation, policyVersion } = args;
  return auditEvent(deps, {
    type: evaluation.verdict === "escalar" ? "invoice.escalated" : "invoice.decided",
    actor: args.actor,
    invoice: args.invoice,
    decisionId: decision.id,
    data: {
      verdict: decision.verdict,
      deciding_rule: decidingFinding(evaluation)?.code ?? null,
      findings: decision.findings.map((f) => f.code),
      rule_log: evaluation.log.map((l) => ({ code: l.code, outcome: l.outcome })),
      policy_version: policyVersion.version,
      policy_hash: policyVersion.content_hash,
      dry_run: decision.dry_run,
      payment_order: decision.payment_order !== null,
    },
    traceId: args.traceId,
    at: decision.decided_at,
  });
}
