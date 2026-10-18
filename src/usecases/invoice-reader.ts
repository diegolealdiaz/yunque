import { withWriteTransaction, type Database } from "@/src/db/client";
import { getCachedExtraction, insertLlmCall, putCachedExtraction } from "@/src/db/repositories";
import { jsonHash, type ExtractionRecord, type Ulid, type UlidGenerator } from "@/src/domain";
import {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  detectAll,
  readInvoice,
  type ExtractionCache,
  type FileStorage,
  type IngestedDocument,
  type ModelClient,
  type ReadInvoiceOptions,
  type ReadInvoiceResult,
} from "@/src/extraction";

/**
 * El Lector visto desde el caso de uso: una sola operación, leer un documento normalizado.
 * La implementación de producción usa el modelo, la caché en base y el registro de
 * llamadas; las pruebas pueden darle cualquier otra.
 */

export type ReadContext = {
  readonly organizationId: Ulid;
  readonly invoiceId: Ulid;
  readonly traceId: string;
};

export interface InvoiceReader {
  read(doc: IngestedDocument, context: ReadContext): Promise<ReadInvoiceResult>;
}

/**
 * Plazo por llamada al modelo y de toda la lectura. La ruta debe dar más que el global (90 s),
 * con margen para renderizar las páginas. Un escaneo de 8 a 10 páginas tarda unos 30 s en
 * leerse; con menos plazo escalaría siempre como ilegible.
 */
export const READ_TIMEOUT_MS = 45_000;
export const READ_DEADLINE_MS = 75_000;

/** La salida cruda se guarda recortada: sirve para depurar, no para reconstruir. */
const MAX_RAW_OUTPUT_CHARS = 20_000;

export type ModelReaderOptions = {
  readonly db: Database;
  readonly storage: FileStorage;
  readonly client: ModelClient;
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly maxOutputTokens: number;
  /**
   * Ámbito de la caché para una organización. En producto, la propia organización; en la
   * demo pública, un ámbito compartido para que cada copia reutilice las lecturas del dataset.
   */
  readonly cacheScope: (organizationId: Ulid) => string;
  readonly newId: UlidGenerator;
  readonly now: () => Date;
  readonly timeoutMs?: number;
  readonly deadlineMs?: number;
};

/** Caché del Lector sobre la tabla `extraction_cache`, indexada por el hash de la llave. */
function databaseCache(db: Database, scope: string, now: () => Date): ExtractionCache {
  return {
    get: (key) => getCachedExtraction(db, scope, jsonHash(key)),
    put: (key, record: ExtractionRecord) =>
      withWriteTransaction(db, (tx) =>
        putCachedExtraction(tx, scope, jsonHash(key), record, now().toISOString()),
      ),
  };
}

/** Lector de producción: modelo principal, respaldo, caché exacta y registro por intento. */
export function createModelReader(options: ModelReaderOptions): InvoiceReader {
  const readOptions: ReadInvoiceOptions = {
    primaryModel: options.primaryModel,
    fallbackModel: options.fallbackModel,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs ?? READ_TIMEOUT_MS,
    deadlineMs: options.deadlineMs ?? READ_DEADLINE_MS,
  };
  return {
    read(doc, context) {
      const { db } = options;
      return readInvoice(
        {
          client: options.client,
          cache: databaseCache(db, options.cacheScope(context.organizationId), options.now),
          // Cada intento se registra en su propia transacción corta, fuera de la de la decisión.
          logCall: (call) =>
            withWriteTransaction(db, (tx) =>
              insertLlmCall(tx, {
                id: options.newId(),
                organization_id: context.organizationId,
                invoice_id: context.invoiceId,
                model: call.model,
                prompt_version: call.prompt_version,
                prompt_hash: call.prompt_hash,
                raw_output: call.raw_output?.slice(0, MAX_RAW_OUTPUT_CHARS) ?? null,
                attempt: call.attempt,
                input_tokens: call.input_tokens,
                output_tokens: call.output_tokens,
                cost_usd_micros: call.cost_usd_micros,
                latency_ms: call.latency_ms,
                status: call.status,
                error: call.error?.slice(0, 1000) ?? null,
                trace_id: context.traceId,
                created_at: options.now().toISOString(),
              }),
            ),
          now: () => options.now().getTime(),
        },
        options.storage,
        doc,
        readOptions,
      );
    },
  };
}

/** Nombre de modelo que queda en el registro cuando la lectura no usó ninguno. */
export const NO_MODEL = "sin-modelo";

/**
 * Lectura sin modelo: "no la entendí" como resultado tipado. El Detector de código sí corre
 * sobre el texto, así que una factura con instrucciones embebidas se frena igual.
 */
export function readWithoutModel(doc: IngestedDocument, reason: string): ReadInvoiceResult {
  const extraction = { kind: "unreadable" as const, reason };
  return {
    record: {
      extraction,
      extraction_hash: jsonHash(extraction),
      model: NO_MODEL,
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
      fallback_used: false,
    },
    verification: {
      evidence_missing: [],
      totals: "not_applicable",
      ambiguities: [],
      suspicions: detectAll({ document: doc.text, channel: doc.channel_text }),
    },
    issues: [],
    passes: [],
    cost_usd_micros: 0,
    latency_ms: 0,
  };
}
