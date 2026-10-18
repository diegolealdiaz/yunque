import {
  EXTRACTED_FIELD_NAMES,
  ExtractedFieldsSchema,
  jsonHash,
  paymentRequestLines,
  type Extraction,
  type PaymentRequest,
} from "@/src/domain";
import {
  SCHEMA_VERSION,
  detectAll,
  verifyExtraction,
  type IngestedDocument,
  type ReadInvoiceResult,
} from "@/src/extraction";

import type { InvoiceReader } from "./invoice-reader";

/**
 * Lector de una solicitud de pago por la API (D32). La solicitud ya trae sus campos: no hace
 * falta el modelo. Cada campo cita su línea del documento que Yunque armó con ella, y pasa
 * por el mismo Verificador y el mismo Detector que una factura leída por el modelo. Así una
 * instrucción escondida en el concepto se frena igual, y lo que no se pueda contrastar con el
 * documento queda sin evidencia y no ayuda a pagar.
 */

/** Lo que queda en el registro como "modelo" de la lectura: no hubo ninguno. */
export const REQUEST_READER = "solicitud-api";
export const REQUEST_READER_VERSION = "solicitud-v1";

const ABSENT = "La solicitud no lo trae";

export function createRequestReader(request: PaymentRequest): InvoiceReader {
  return {
    read: (doc) => Promise.resolve(readRequest(request, doc)),
  };
}

function readRequest(request: PaymentRequest, doc: IngestedDocument): ReadInvoiceResult {
  // Sin texto no hay contra qué verificar las citas: el Verificador las daría por buenas.
  // El documento lo arma Yunque y siempre tiene texto; si no, la solicitud escala.
  const extraction: Extraction = doc.has_text_layer
    ? requestExtraction(request)
    : { kind: "unreadable", reason: "El documento de la solicitud no tiene texto que verificar" };
  const verification = verifyExtraction(extraction, doc.text);
  return {
    record: {
      extraction,
      extraction_hash: jsonHash(extraction),
      model: REQUEST_READER,
      prompt_version: REQUEST_READER_VERSION,
      schema_version: SCHEMA_VERSION,
      fallback_used: false,
    },
    verification: {
      ...verification.report,
      suspicions: [
        ...verification.report.suspicions,
        ...detectAll({ document: doc.text, channel: doc.channel_text }),
      ],
    },
    issues: verification.issues,
    passes: [],
    cost_usd_micros: 0,
    latency_ms: 0,
  };
}

/**
 * La extracción de la solicitud: cada campo presente con su línea como evidencia y origen
 * `api`; los ausentes, explícitos. El esquema del dominio valida el resultado, así un valor
 * que no cumple su tipo no llega al motor.
 */
function requestExtraction(request: PaymentRequest): Extraction {
  const lines = new Map(paymentRequestLines(request).map((l) => [l.field, l]));
  const fields = Object.fromEntries(
    EXTRACTED_FIELD_NAMES.map((name) => {
      const line = lines.get(name);
      if (line === undefined) return [name, { value: null, reason: ABSENT }];
      return [
        name,
        {
          value: line.value,
          evidence: { literal: line.literal, quote: `${line.label}: ${line.literal}`, page: 1 },
          confidence: 1,
          source: "api",
        },
      ];
    }),
  );
  return {
    kind: "invoice",
    fields: ExtractedFieldsSchema.parse(fields),
    ambiguities: [],
    suspicions: [],
    language: "es",
  };
}
