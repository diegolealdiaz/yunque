import { withWriteTransaction, type Database } from "@/src/db/client";
import { DbError } from "@/src/db/errors";
import {
  appendEvent,
  findInvoiceByReceiptKey,
  getCurrentPolicy,
  getInvoice,
  getLatestDecision,
  getOrganization,
  insertInvoice,
  listVendors,
  nextReference,
  transitionInvoice,
} from "@/src/db/repositories";
import {
  ReceiptKeySchema,
  type Channel,
  type Decision,
  type Invoice,
  type Organization,
  type ReceiptKey,
  type Ulid,
} from "@/src/domain";
import type { Evaluation } from "@/src/engine";
import {
  IngestError,
  normalizeDocument,
  receiveDocument,
  storeOriginal,
  type FileStorage,
  type IngestLimits,
  type ReceivedDocument,
} from "@/src/extraction";
import { resolvePayee } from "@/src/resolve";

import { auditEvent, decideAndRecord, type DecideDeps } from "./decide";
import { UseCaseError } from "./errors";
import { escalateOnFailure } from "./escalate-on-failure";
import { READ_DEADLINE_MS, readWithoutModel, type InvoiceReader } from "./invoice-reader";
import { StageFailure, inStage } from "./stage";

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
 *   sin volver a procesarla, salvo que haya quedado `fallida` o abandonada en `procesando`:
 *   entonces la entrega repetida es el reintento. El mismo archivo por otra entrega es otra
 *   factura, y el motor la frena como duplicada. Por subida o lote la caché del Lector evita
 *   pagar el modelo otra vez; por correo o chat el cuerpo entra al prompt y se vuelve a leer.
 * - Antes de registrar la factura, los fallos son excepciones tipadas (`UseCaseError`):
 *   entrega rechazada, empresa o política ausentes. No queda nada a medias.
 * - Después de registrarla, cualquier fallo de una etapa termina en `escalar` con el
 *   hallazgo `processing_error` y su evento. Nunca en `pagar`, nunca en un estado intermedio;
 *   si ni eso se puede escribir, la factura pasa a `fallida` para reintentarla.
 * - La decisión, su extracción, la reserva de presupuesto, el débito de saldo, los eventos y
 *   los avisos se escriben en una sola transacción. Si entre la evaluación y la escritura
 *   otra decisión gastó el presupuesto, registró el mismo cobro o cambió la política, se
 *   reevalúa con datos frescos: la política se consulta en cada intento, no al empezar.
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

/** Además de lo que necesita toda decisión (`DecideDeps`), el documento y quién lo lee. */
export type ProcessInvoiceDeps = DecideDeps & {
  readonly storage: FileStorage;
  /** Lector. Null cuando no hay clave del modelo: la factura escala como ilegible. */
  readonly reader: InvoiceReader | null;
  readonly limits: IngestLimits;
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
const NO_DOCUMENT = "El mensaje no trae una factura adjunta";

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export async function processInvoice(
  deps: ProcessInvoiceDeps,
  input: ProcessInvoiceInput,
): Promise<ProcessInvoiceResult> {
  const { db } = deps;
  const traceId = input.traceId ?? `tr-${deps.newId()}`;
  assertReceiptKey(input.receiptKey);

  const existing = await findInvoiceByReceiptKey(db, input.organizationId, input.receiptKey);
  if (existing && !isRetryable(existing, deps.now())) return alreadyReceived(db, existing);

  const organization = await loadOrganization(db, input.organizationId);
  const policyVersion = await getCurrentPolicy(db, organization.id);
  if (!policyVersion) {
    throw new UseCaseError("policy_missing", "La empresa no tiene una política vigente", {
      action: "Guarda una política en la pantalla de Reglas antes de procesar facturas",
    });
  }

  const received = receive(input, deps.limits, organization.id);
  if (existing && existing.document_hash !== received.document_hash) {
    throw new UseCaseError("rejected_document", "Esa entrega ya existe con otro documento", {
      action: "Usa una llave de recepción nueva para un documento distinto",
      severity: "warning",
    });
  }
  try {
    await storeOriginal(received, deps.storage);
  } catch (error) {
    throw new UseCaseError("storage_unavailable", "No se pudo guardar el documento", {
      action: "Vuelve a intentarlo en unos minutos",
      retryable: true,
      cause: error,
    });
  }

  const started = existing
    ? await reclaimForRetry(deps, existing, traceId)
    : await registerInvoice(deps, { organization, received, input, traceId });
  if (started.kind === "already_received") return started;
  const invoice = started.invoice;

  try {
    return await decide(deps, { organization, invoice, received, traceId });
  } catch (error) {
    const failure = error instanceof StageFailure ? error : new StageFailure("record", error);
    const escalated = await escalateOnFailure(deps, {
      organization,
      policyVersion,
      invoice,
      failure,
      traceId,
    });
    return { kind: "decided", ...escalated, evaluation: null };
  }
}

/** Una llave mal formada se rechaza antes de tocar nada, con un error que dice qué hacer. */
function assertReceiptKey(key: string): void {
  if (!ReceiptKeySchema.safeParse(key).success) {
    throw new UseCaseError("rejected_document", "La llave de recepción no es válida", {
      action: "Construye la llave con receiptKeyFor(canal, identificador)",
      severity: "warning",
    });
  }
}

/**
 * Cuánto puede seguir una factura en `procesando` antes de darla por abandonada: el plazo
 * de lectura más un margen para normalizar y registrar. Pasado eso, la función que la
 * procesaba murió (por ejemplo, por el tope de duración de la ruta).
 */
export const STALE_PROCESSING_MS = READ_DEADLINE_MS + 60_000;

/** Una entrega repetida se vuelve a procesar si quedó fallida o abandonada en `procesando`. */
function isRetryable(invoice: Invoice, now: Date): boolean {
  if (invoice.status === "fallida") return true;
  return (
    invoice.status === "procesando" &&
    now.getTime() - Date.parse(invoice.updated_at) > STALE_PROCESSING_MS
  );
}

/**
 * Retoma una factura para reintentarla: la abandonada pasa primero a `fallida` con su
 * evento, y de `fallida` vuelve a `procesando`. Ambas transiciones por comparación y
 * cambio: si otra petición la retomó antes, gana esa y aquí se devuelve la existente.
 */
async function reclaimForRetry(
  deps: ProcessInvoiceDeps,
  invoice: Invoice,
  traceId: string,
): Promise<ProcessInvoiceResult | { readonly kind: "registered"; readonly invoice: Invoice }> {
  const at = deps.now().toISOString();
  try {
    await withWriteTransaction(deps.db, async (tx) => {
      if (invoice.status === "procesando") {
        await transitionInvoice(
          tx,
          invoice.organization_id,
          invoice.id,
          "procesando",
          "fallida",
          at,
        );
        await appendEvent(
          tx,
          auditEvent(deps, {
            type: "invoice.failed",
            invoice,
            data: { reason: "abandonada en procesando", stale_ms: STALE_PROCESSING_MS },
            traceId,
            at,
          }),
        );
      }
      await transitionInvoice(tx, invoice.organization_id, invoice.id, "fallida", "procesando", at);
      await appendEvent(
        tx,
        auditEvent(deps, {
          type: "invoice.processing",
          invoice,
          data: { retry: true },
          traceId,
          at,
        }),
      );
    });
  } catch (error) {
    if (error instanceof DbError && error.code === "stale_state") {
      const current = await getInvoice(deps.db, invoice.organization_id, invoice.id);
      return alreadyReceived(deps.db, current);
    }
    throw error;
  }
  return { kind: "registered", invoice: { ...invoice, status: "procesando", updated_at: at } };
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
        auditEvent(deps, {
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
        auditEvent(deps, { type: "invoice.processing", invoice: fresh, data: {}, traceId, at }),
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

type DecideFromDocument = {
  readonly organization: Organization;
  readonly invoice: Invoice;
  readonly received: ReceivedDocument;
  readonly traceId: string;
};

async function decide(
  deps: ProcessInvoiceDeps,
  args: DecideFromDocument,
): Promise<ProcessInvoiceResult> {
  const { organization, invoice, received, traceId } = args;

  const doc = await inStage("normalize", () =>
    normalizeDocument(received, organization.id, deps.storage, deps.limits),
  );
  const normalizedAt = deps.now().toISOString();

  // Sin páginas (un correo sin adjunto) no hay factura que leer: no se llama al modelo.
  const read = await inStage("read", () =>
    doc.pages.length === 0
      ? readWithoutModel(doc, NO_DOCUMENT)
      : deps.reader
        ? deps.reader.read(doc, { organizationId: organization.id, invoiceId: invoice.id, traceId })
        : readWithoutModel(doc, LECTOR_OFF),
  );
  const extractedAt = deps.now().toISOString();

  const payee = await inStage("resolve", async () => {
    const extraction = read.record.extraction;
    if (extraction.kind !== "invoice") return { kind: "unknown", closest: null } as const;
    return resolvePayee(extraction.fields, await listVendors(deps.db, organization.id));
  });

  const pipelineEvents = [
    auditEvent(deps, {
      type: "invoice.normalized",
      invoice,
      data: { pages: doc.pages.length, has_text_layer: doc.has_text_layer },
      traceId,
      at: normalizedAt,
    }),
    auditEvent(deps, {
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

  const decided = await decideAndRecord(deps, {
    organization,
    invoice,
    reading: read,
    payee,
    pipelineEvents,
    traceId,
    actor: { kind: "agente" },
    previousDecisionId: null,
    documentPatch: {
      text: doc.has_text_layer ? doc.text.slice(0, 200_000) : null,
      page_keys: doc.pages.map((p) => p.pngKey),
    },
  });
  return { kind: "decided", ...decided };
}
