import { withWriteTransaction, type Database } from "@/src/db/client";
import { DbError } from "@/src/db/errors";
import {
  appendEvent,
  ensureLedgerPeriod,
  findInvoiceByReceiptKey,
  getCurrentPolicy,
  getInvoice,
  getLatestDecision,
  getLedgerPeriod,
  getOrganization,
  insertInvoice,
  listBalances,
  listPriorInvoices,
  listVendors,
  nextReference,
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
  type AuditEvent,
  type Channel,
  type Decision,
  type EventType,
  type ExtractedFieldName,
  type Extraction,
  type FieldSource,
  type Finding,
  type Invoice,
  type Money,
  type Organization,
  type PaymentOrderDraft,
  type PolicyVersion,
  type ReceiptKey,
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
} from "@/src/engine";
import { explainDecision } from "@/src/explain";
import {
  IngestError,
  ModelError,
  normalizeDocument,
  receiveDocument,
  storeOriginal,
  type FileStorage,
  type IngestLimits,
  type IngestedDocument,
  type ReadInvoiceResult,
  type ReceivedDocument,
} from "@/src/extraction";
import { resolvePayee } from "@/src/resolve";

import { businessDateOf, engineNow } from "./business-day";
import { UseCaseError } from "./errors";
import { readWithoutModel, type InvoiceReader } from "./invoice-reader";
import {
  approvalExpiry,
  notificationsFor,
  recordDecision,
  statusFor,
  type DecisionRecord,
  type Reservation,
} from "./record-decision";

/**
 * processInvoice: el único camino por el que una factura entra y sale decidida. Todos los
 * canales (subida, lote, bandeja, Telegram, API) terminan aquí.
 *
 *   entrega ─► recepción ─► registro ─► normalización ─► lectura ─► resolución ─► evaluación ─► registro de la decisión
 *              (rechazo)    (recibida,                                                         (decidida o
 *                            procesando)                                                        esperando_aprobacion)
 *
 * Garantías:
 * - Idempotencia por entrega: la misma `receiptKey` dos veces devuelve la factura existente
 *   sin volver a procesarla. El mismo archivo por otra entrega es otra factura, y el motor
 *   la frena como duplicada (la caché del Lector evita pagar el modelo dos veces).
 * - Antes de registrar la factura, los fallos son excepciones tipadas (`UseCaseError`):
 *   entrega rechazada, empresa o política ausentes. No queda nada a medias.
 * - Después de registrarla, cualquier fallo de una etapa termina en `escalar` con el
 *   hallazgo `processing_error` y su evento. Nunca en `pagar`, nunca en un estado intermedio;
 *   si ni eso se puede escribir, la factura pasa a `fallida` para reintentarla.
 * - La decisión, su extracción, la reserva de presupuesto, el débito de saldo, los eventos y
 *   los avisos se escriben en una sola transacción. Si otra decisión gastó el presupuesto
 *   entre la lectura y la escritura, se reevalúa una vez con datos frescos.
 * - El modelo solo lee. El veredicto sale del motor, puro; la cuenta de la orden de pago
 *   sale del vendor registrado.
 */

export type ProcessInvoiceInput = {
  readonly organizationId: Ulid;
  readonly channel: Channel;
  /** Identidad de la entrega: id del correo, update de Telegram, caso del lote, etc. */
  readonly receiptKey: ReceiptKey;
  readonly bytes: Uint8Array;
  /** Nombre que trajo el archivo. Solo informativo: nunca se usa como ruta. */
  readonly originalName: string;
  /** Id de traza de la petición; si falta, se genera uno. */
  readonly traceId?: string;
};

export type ProcessInvoiceDeps = {
  readonly db: Database;
  readonly storage: FileStorage;
  /** Lector. Null cuando no hay clave del modelo: la factura escala como ilegible. */
  readonly reader: InvoiceReader | null;
  readonly limits: IngestLimits;
  readonly newId: UlidGenerator;
  /** Reloj de instantes: fechas de recepción, eventos y decisión. */
  readonly now: () => Date;
  /** Zona de la empresa para calcular el día de negocio. */
  readonly timeZone: string;
  /**
   * Día de negocio fijo (`YYYY-MM-DD`) en lugar del calculado con el reloj. La demo lo fija
   * al día del dataset para que vencimientos y ventanas den siempre lo mismo.
   */
  readonly businessDate?: string;
};

export type ProcessInvoiceResult =
  | {
      readonly kind: "decided";
      readonly invoice: Invoice;
      readonly decision: Decision;
      /** Registro regla por regla del motor; null si la factura escaló por un error de proceso. */
      readonly evaluation: Evaluation | null;
    }
  | {
      /** La entrega ya se había recibido: no se procesó otra vez. */
      readonly kind: "already_received";
      readonly invoice: Invoice;
      /** Decisión vigente, o null si la primera vez todavía no terminó. */
      readonly decision: Decision | null;
    };

const LECTOR_OFF = "El Lector está apagado: falta la clave del modelo";

// ---------------------------------------------------------------------------
// Etapas. Cada error dentro de una etapa sale envuelto con el nombre de la etapa, que es
// lo que la persona lee en el hallazgo.
// ---------------------------------------------------------------------------

const STAGE_LABELS = {
  normalize: "normalización del documento",
  read: "lectura y verificación",
  resolve: "resolución del beneficiario",
  evaluate: "evaluación de reglas",
  record: "registro de la decisión",
} as const;
type Stage = keyof typeof STAGE_LABELS;

class StageFailure extends Error {
  readonly stage: Stage;
  constructor(stage: Stage, cause: unknown) {
    super(`Falló la etapa ${stage}`, { cause });
    this.name = "StageFailure";
    this.stage = stage;
  }
}

async function inStage<T>(stage: Stage, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw error instanceof StageFailure ? error : new StageFailure(stage, error);
  }
}

/** Código corto y mensaje seguro de un error. Un error desconocido no expone su texto. */
function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof IngestError) return { code: error.code, message: error.message };
  if (error instanceof DbError) return { code: error.code, message: "error de la base de datos" };
  if (error instanceof ModelError) return { code: error.code, message: "error del modelo" };
  if (error instanceof UseCaseError) return { code: error.code, message: error.message };
  return { code: "unexpected", message: "error inesperado" };
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export async function processInvoice(
  deps: ProcessInvoiceDeps,
  input: ProcessInvoiceInput,
): Promise<ProcessInvoiceResult> {
  const { db } = deps;
  const traceId = input.traceId ?? `tr-${deps.newId()}`;

  const existing = await findInvoiceByReceiptKey(db, input.organizationId, input.receiptKey);
  if (existing) return alreadyReceived(db, existing);

  const organization = await loadOrganization(db, input.organizationId);
  const policyVersion = await getCurrentPolicy(db, organization.id);
  if (!policyVersion) {
    throw new UseCaseError("policy_missing", "La empresa no tiene una política vigente", {
      action: "Guarda una política en la pantalla de Reglas antes de procesar facturas",
    });
  }

  const received = receive(input, deps.limits, organization.id);
  try {
    await storeOriginal(received, deps.storage);
  } catch (error) {
    throw new UseCaseError("storage_unavailable", "No se pudo guardar el documento", {
      action: "Vuelve a intentarlo en unos minutos",
      retryable: true,
      cause: error,
    });
  }

  const registered = await registerInvoice(deps, { organization, received, input, traceId });
  if (registered.kind === "already_received") return registered;
  const invoice = registered.invoice;

  try {
    return await decide(deps, { organization, policyVersion, invoice, received, traceId });
  } catch (error) {
    const failure = error instanceof StageFailure ? error : new StageFailure("record", error);
    return escalateOnFailure(deps, { organization, policyVersion, invoice, failure, traceId });
  }
}

async function loadOrganization(db: Database, organizationId: Ulid): Promise<Organization> {
  try {
    return await getOrganization(db, organizationId);
  } catch (error) {
    if (error instanceof DbError && error.code === "not_found") {
      throw new UseCaseError("organization_not_found", "La empresa no existe", {
        action: "Vuelve a entrar a la demo para recibir una empresa nueva",
      });
    }
    throw error;
  }
}

/** Valida la entrega. Un rechazo no registra factura: no hay documento que decidir. */
function receive(input: ProcessInvoiceInput, limits: IngestLimits, prefix: Ulid): ReceivedDocument {
  try {
    return receiveDocument(
      { bytes: input.bytes, originalName: input.originalName, storagePrefix: prefix },
      limits,
    );
  } catch (error) {
    if (error instanceof IngestError) {
      throw new UseCaseError("rejected_document", error.message, {
        action: error.action,
        severity: "warning",
        cause: error,
      });
    }
    throw error;
  }
}

async function alreadyReceived(db: Database, invoice: Invoice): Promise<ProcessInvoiceResult> {
  const decision = await getLatestDecision(db, invoice.organization_id, invoice.id);
  return { kind: "already_received", invoice, decision };
}

function event(
  deps: Pick<ProcessInvoiceDeps, "newId">,
  input: {
    readonly type: EventType;
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
    actor: { kind: "agente" },
    invoice_id: input.invoice.id,
    decision_id: input.decisionId ?? null,
    data: input.data,
    trace_id: input.traceId,
    occurred_at: input.at,
  };
}

/**
 * Registra la factura y la deja en `procesando`, con sus dos eventos, en una transacción.
 * Si otra petición registró la misma entrega un instante antes, gana esa.
 */
async function registerInvoice(
  deps: ProcessInvoiceDeps,
  args: {
    readonly organization: Organization;
    readonly received: ReceivedDocument;
    readonly input: ProcessInvoiceInput;
    readonly traceId: string;
  },
): Promise<ProcessInvoiceResult | { readonly kind: "registered"; readonly invoice: Invoice }> {
  const { organization, received, input, traceId } = args;
  const now = deps.now();
  const at = now.toISOString();
  try {
    const invoice = await withWriteTransaction(deps.db, async (tx) => {
      const reference = await nextReference(
        tx,
        organization.id,
        organization.reference_prefix,
        now,
      );
      const fresh: Invoice = {
        id: deps.newId(),
        organization_id: organization.id,
        reference,
        channel: input.channel,
        receipt_key: input.receiptKey,
        source_kind: received.source_kind,
        document_hash: received.document_hash,
        file_key: received.file_key,
        file_state: "subida",
        original_name: input.originalName.slice(0, 255),
        mime_type: received.mime_type,
        size_bytes: received.size_bytes,
        page_keys: [],
        text: null,
        semantic_key: null,
        status: "recibida",
        approval_expires_at: null,
        channel_meta: received.channel_meta,
        received_at: at,
        updated_at: at,
      };
      await insertInvoice(tx, fresh);
      await appendEvent(
        tx,
        event(deps, {
          type: "invoice.received",
          invoice: fresh,
          data: {
            channel: fresh.channel,
            source_kind: fresh.source_kind,
            document_hash: fresh.document_hash,
            size_bytes: fresh.size_bytes,
          },
          traceId,
          at,
        }),
      );
      await transitionInvoice(tx, organization.id, fresh.id, "recibida", "procesando", at);
      await appendEvent(
        tx,
        event(deps, { type: "invoice.processing", invoice: fresh, data: {}, traceId, at }),
      );
      return { ...fresh, status: "procesando" as const };
    });
    return { kind: "registered", invoice };
  } catch (error) {
    if (error instanceof DbError && error.code === "conflict") {
      const winner = await findInvoiceByReceiptKey(deps.db, organization.id, input.receiptKey);
      if (winner) return alreadyReceived(deps.db, winner);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Camino feliz: normalizar, leer, resolver, evaluar y registrar.
// ---------------------------------------------------------------------------

type DecideArgs = {
  readonly organization: Organization;
  readonly policyVersion: PolicyVersion;
  readonly invoice: Invoice;
  readonly received: ReceivedDocument;
  readonly traceId: string;
};

async function decide(deps: ProcessInvoiceDeps, args: DecideArgs): Promise<ProcessInvoiceResult> {
  const { organization, invoice, received, traceId } = args;

  const doc = await inStage("normalize", () =>
    normalizeDocument(received, organization.id, deps.storage, deps.limits),
  );
  const normalizedAt = deps.now().toISOString();

  const read = await inStage("read", () =>
    deps.reader
      ? deps.reader.read(doc, { organizationId: organization.id, invoiceId: invoice.id, traceId })
      : readWithoutModel(doc, LECTOR_OFF),
  );
  const extractedAt = deps.now().toISOString();

  const payee = await inStage("resolve", async () => {
    const extraction = read.record.extraction;
    if (extraction.kind !== "invoice") return { kind: "unknown", closest: null } as const;
    return resolvePayee(extraction.fields, await listVendors(deps.db, organization.id));
  });

  const today = deps.businessDate ?? businessDateOf(deps.now(), deps.timeZone);
  const pipelineEvents = [
    event(deps, {
      type: "invoice.normalized",
      invoice,
      data: { pages: doc.pages.length, has_text_layer: doc.has_text_layer },
      traceId,
      at: normalizedAt,
    }),
    event(deps, {
      type: "invoice.extracted",
      invoice,
      data: {
        kind: read.record.extraction.kind,
        model: read.record.model,
        prompt_version: read.record.prompt_version,
        fallback_used: read.record.fallback_used,
        from_cache: read.passes.length > 0 && read.passes.every((p) => p.from_cache),
        model_calls: read.passes.length,
        extraction_hash: read.record.extraction_hash,
        verification_issues: read.issues.length,
        cost_usd_micros: read.cost_usd_micros,
        latency_ms: read.latency_ms,
      },
      traceId,
      at: extractedAt,
    }),
  ];

  // Una reserva puede perder la carrera contra otra decisión simultánea: se reevalúa una
  // sola vez con ledger y saldos frescos, y esa vez el motor ya ve el presupuesto gastado.
  for (let attempt = 1; ; attempt++) {
    const context = await inStage("evaluate", () =>
      evaluationContext(deps, { ...args, doc, read, payee, today }),
    );
    const evaluation = await inStage("evaluate", () => evaluate(context));
    const record = await inStage("record", () =>
      buildRecord(deps, { ...args, doc, read, payee, context, evaluation, pipelineEvents }),
    );
    try {
      await inStage("record", () => recordDecision(deps.db, record));
    } catch (error) {
      const cause = error instanceof StageFailure ? error.cause : error;
      const lostRace =
        cause instanceof DbError &&
        (cause.code === "budget_exceeded" || cause.code === "insufficient_balance");
      if (lostRace && attempt === 1) continue;
      throw error;
    }
    const saved = await getInvoice(deps.db, organization.id, invoice.id);
    return { kind: "decided", invoice: saved, decision: record.decision, evaluation };
  }
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

/** Todo lo que el motor necesita, leído de la base. El periodo del mes se crea si falta. */
async function evaluationContext(
  deps: ProcessInvoiceDeps,
  args: DecideArgs & {
    readonly doc: IngestedDocument;
    readonly read: ReadInvoiceResult;
    readonly payee: PayeeMatch;
    readonly today: string;
  },
): Promise<EvaluationContext> {
  const { organization, policyVersion, invoice, read, payee } = args;
  const policy = policyVersion.content;
  const now = engineNow(args.today);
  const { budget } = policy.limits;
  const period = periodKey(now, budget.period);
  await withWriteTransaction(deps.db, (tx) =>
    ensureLedgerPeriod(
      tx,
      organization.id,
      period,
      budget.currency,
      budget.amount,
      deps.now().toISOString(),
    ),
  );
  const key = semanticKeyOf(read.record.extraction, payee);
  const [ledger, balances, prior] = await Promise.all([
    getLedgerPeriod(deps.db, organization.id, period, budget.currency),
    listBalances(deps.db, organization.id),
    listPriorInvoices(deps.db, organization.id, {
      vendorId: payee.kind === "matched" ? payee.vendor.id : null,
      semanticKey: key,
      documentHash: invoice.document_hash,
      excludeInvoiceId: invoice.id,
    }),
  ]);
  return {
    extraction: read.record.extraction,
    verification: read.verification,
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
  deps: ProcessInvoiceDeps,
  args: DecideArgs & {
    readonly doc: IngestedDocument;
    readonly read: ReadInvoiceResult;
    readonly payee: PayeeMatch;
    readonly context: EvaluationContext;
    readonly evaluation: Evaluation;
    readonly pipelineEvents: readonly AuditEvent[];
  },
): DecisionRecord {
  const { organization, policyVersion, invoice, doc, read, payee, context, evaluation } = args;
  const policy = policyVersion.content;
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
    previous_decision_id: null,
    dry_run: dryRun,
    actor: { kind: "agente" },
    cost_usd_micros: read.cost_usd_micros,
    latency_ms: read.latency_ms,
    decided_at: at,
  };

  const deciding = decidingFinding(evaluation);
  const decidedEvent = event(deps, {
    type: evaluation.verdict === "escalar" ? "invoice.escalated" : "invoice.decided",
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
    patch: {
      text: doc.has_text_layer ? doc.text.slice(0, 200_000) : null,
      page_keys: doc.pages.map((p) => p.pngKey),
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
      channel: invoice.channel,
      newId: deps.newId,
      nowIso: at,
    }),
  };
}

// ---------------------------------------------------------------------------
// Camino de error: la factura ya registrada escala con el error como motivo.
// ---------------------------------------------------------------------------

async function escalateOnFailure(
  deps: ProcessInvoiceDeps,
  args: {
    readonly organization: Organization;
    readonly policyVersion: PolicyVersion;
    readonly invoice: Invoice;
    readonly failure: StageFailure;
    readonly traceId: string;
  },
): Promise<ProcessInvoiceResult> {
  const { organization, policyVersion, invoice, failure, traceId } = args;
  const error = describeError(failure.cause);
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
  try {
    await recordDecision(deps.db, {
      invoice,
      decision,
      patch: { approval_expires_at: approvalExpiry("escalar", now) },
      extraction: null,
      reservation: null,
      events: [
        event(deps, {
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
        channel: invoice.channel,
        newId: deps.newId,
        nowIso: at,
      }),
    });
  } catch (recordError) {
    await markFailed(deps, { invoice, errorData, traceId, at }, recordError);
  }
  const saved = await getInvoice(deps.db, organization.id, invoice.id);
  if (saved.status !== statusFor("escalar")) {
    throw new UseCaseError("record_failed", "La factura quedó marcada como fallida", {
      action: "Reintenta el procesamiento desde la lista de facturas",
      retryable: true,
      cause: failure,
    });
  }
  return { kind: "decided", invoice: saved, decision, evaluation: null };
}

/**
 * Último recurso: ni la decisión de escalado se pudo escribir. La factura pasa a `fallida`,
 * un estado del que solo se sale reintentando. Si tampoco eso se puede, el error sube.
 */
async function markFailed(
  deps: ProcessInvoiceDeps,
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
        event(deps, {
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
      action: "Revisa la salud del sistema y reintenta",
      retryable: true,
      cause: error,
    });
  }
}
