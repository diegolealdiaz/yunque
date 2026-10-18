import { z } from "zod";

import { Sha256Schema } from "./hash";

/**
 * Extracción: lo que el Lector leyó del documento, campo por campo, con evidencia.
 *
 * Cada campo lleva el valor normalizado, la cadena literal tal como aparece, una cita
 * del documento que la contiene, la confianza del modelo y la fuente (modelo o persona).
 * El Verificador comprueba que la cita exista en el texto y que el valor se derive de la
 * literal. Sin evidencia válida el campo no cuenta como leído.
 *
 * Cuatro campos son obligatorios para que el resultado sea `invoice`: beneficiario,
 * número, moneda y total. Si el Lector no encuentra alguno, devuelve `unreadable` con el
 * motivo; el resto de campos admite un `Missing` explícito con su razón.
 */

export const FieldSourceSchema = z.enum(["modelo", "humano"]);
export type FieldSource = z.infer<typeof FieldSourceSchema>;

export const EvidenceSchema = z.strictObject({
  /** Texto exacto del documento del que se derivó el valor. */
  literal: z.string().min(1).max(500),
  /** Fragmento más amplio que contiene la literal, para localizarla y resaltarla. */
  quote: z.string().min(1).max(2000),
  /** Página (base 1) si se conoce. */
  page: z.number().int().min(1).max(20).nullable(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

function field<T extends z.ZodType>(value: T) {
  return z.strictObject({
    value,
    evidence: EvidenceSchema,
    confidence: z.number().min(0).max(1),
    source: FieldSourceSchema,
  });
}

/** Campo que el Lector no pudo leer o que una persona dejó vacío a propósito. */
const MissingSchema = z.strictObject({ value: z.null(), reason: z.string().min(1).max(500) });
export type Missing = z.infer<typeof MissingSchema>;

/** Campo leído con evidencia. */
export type Present<T> = {
  readonly value: T;
  readonly evidence: Evidence;
  readonly confidence: number;
  readonly source: FieldSource;
};

/**
 * Código de moneda tal como aparece en el documento, en tres letras mayúsculas. Puede no
 * estar soportado: el motor lo contrasta con el catálogo y emite `unsupported_currency_or_rail`.
 */
const CurrencyCodeAsRead = z.string().regex(/^[A-Z]{3}$/);

export const ExtractedFieldsSchema = z.strictObject({
  payee_name: field(z.string().min(1).max(200)),
  payee_tax_id: field(z.string().min(1).max(50)).or(MissingSchema),
  invoice_number: field(z.string().min(1).max(100)),
  issue_date: field(z.iso.date()).or(MissingSchema),
  due_date: field(z.iso.date()).or(MissingSchema),
  currency: field(CurrencyCodeAsRead),
  /** Unidad mínima de la moneda extraída. */
  subtotal: field(z.number().int().min(0)).or(MissingSchema),
  taxes: field(z.number().int().min(0)).or(MissingSchema),
  total: field(z.number().int().positive()),
  bank_account: field(z.string().min(4).max(64)).or(MissingSchema),
  bank_holder: field(z.string().min(1).max(200)).or(MissingSchema),
  /** Horas reportadas en facturas de contratistas por hora. */
  hours: field(z.number().int().min(0).max(10_000)).or(MissingSchema),
  purchase_order: field(z.string().min(1).max(50)).or(MissingSchema),
  description: field(z.string().min(1).max(1000)).or(MissingSchema),
});
export type ExtractedFields = z.infer<typeof ExtractedFieldsSchema>;

/** Nombres de los campos, derivados del esquema para que no se desincronicen. */
export const ExtractedFieldNameSchema = ExtractedFieldsSchema.keyof();
export type ExtractedFieldName = z.infer<typeof ExtractedFieldNameSchema>;
export const EXTRACTED_FIELD_NAMES = ExtractedFieldNameSchema.options;

/** Cada campo leído como lo nombra una persona en una frase: nunca el nombre interno. */
export const FIELD_PHRASE: Readonly<Record<ExtractedFieldName, string>> = {
  payee_name: "el beneficiario",
  payee_tax_id: "la identificación",
  invoice_number: "el número de factura",
  issue_date: "la fecha de emisión",
  due_date: "la fecha de vencimiento",
  currency: "la moneda",
  subtotal: "el subtotal",
  taxes: "los impuestos",
  total: "el monto",
  bank_account: "la cuenta",
  bank_holder: "el titular",
  hours: "las horas",
  purchase_order: "la orden de compra",
  description: "el concepto",
};

/** Candidatos alternativos que el modelo vio para un campo: base de `field_ambiguous`. */
export const AmbiguitySchema = z.strictObject({
  field: ExtractedFieldNameSchema,
  candidates: z.array(z.string().min(1).max(500)).min(2).max(10),
});
export type Ambiguity = z.infer<typeof AmbiguitySchema>;

/** Señales de inyección que el modelo reporta. El Detector de código las confirma aparte. */
export const SuspicionSchema = z.strictObject({
  kind: z.enum(["instruction_to_agent", "hidden_text", "canary", "amount_in_words_differs"]),
  quote: z.string().min(1).max(1000),
});
export type Suspicion = z.infer<typeof SuspicionSchema>;

/** Resultado tipado del Lector. "No la entendí" es un valor, no una excepción. */
export const ExtractionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("invoice"),
    fields: ExtractedFieldsSchema,
    ambiguities: z.array(AmbiguitySchema).max(20),
    suspicions: z.array(SuspicionSchema).max(20),
    language: z.string().min(2).max(10),
  }),
  z.strictObject({
    kind: z.literal("not_invoice"),
    reason: z.string().min(1).max(500),
    suspicions: z.array(SuspicionSchema).max(20),
  }),
  z.strictObject({
    kind: z.literal("unreadable"),
    reason: z.string().min(1).max(500),
  }),
]);
export type Extraction = z.infer<typeof ExtractionSchema>;

/** Extracción persistida con su procedencia, para reproducir la decisión. */
export const ExtractionRecordSchema = z.strictObject({
  extraction: ExtractionSchema,
  extraction_hash: Sha256Schema,
  model: z.string().min(1).max(100),
  prompt_version: z.string().min(1).max(50),
  schema_version: z.number().int().positive(),
  /** Segunda pasada con el modelo de respaldo. */
  fallback_used: z.boolean(),
});
export type ExtractionRecord = Readonly<z.infer<typeof ExtractionRecordSchema>>;

/** Distingue un campo leído de uno ausente; funciona sobre cualquier unión de campos. */
export function isPresent<T extends { readonly value: unknown }>(
  f: T,
): f is Exclude<T, { readonly value: null }> {
  return f.value !== null;
}
