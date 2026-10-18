import { z } from "zod";

import {
  CurrencySchema,
  ExtractionSchema,
  RuleCodeSchema,
  Sha256Schema,
  VerdictSchema,
} from "@/src/domain";

/**
 * Esquemas del dataset: plantillas de documento, manifiesto de casos e historial.
 * Todo es ficticio. El manifiesto es la verdad esperada: cada caso declara el veredicto,
 * la regla principal y el motivo con los que se mide al sistema.
 */

/** Fecha "de hoy" del dataset: todas las ventanas y vencimientos se calculan contra ella. */
export const DATASET_TODAY = "2026-10-17";

const Mm = z.number().min(0).max(300);

/** Texto fijo de la plantilla: títulos, etiquetas, pie. */
export const LabelSchema = z.strictObject({
  text: z.string().min(1).max(200),
  x: Mm,
  y: Mm,
  width: Mm,
  height: Mm,
  fontSize: z.number().min(6).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

/** Nombres de los campos que una plantilla puede pintar, con su valor tomado del caso. */
export const TEMPLATE_FIELD_NAMES = [
  "payee_name",
  "payee_tax_id",
  "invoice_number",
  "issue_date",
  "due_date",
  "currency",
  "subtotal",
  "taxes",
  "total",
  "total_in_words",
  "bank_account",
  "bank_holder",
  "hours",
  "purchase_order",
  "description",
  "customer",
  "extra",
] as const;
export const TemplateFieldNameSchema = z.enum(TEMPLATE_FIELD_NAMES);
export type TemplateFieldName = z.infer<typeof TemplateFieldNameSchema>;

/** Campo variable: posición, tamaño y formato del valor. */
export const FieldSlotSchema = z.strictObject({
  name: TemplateFieldNameSchema,
  x: Mm,
  y: Mm,
  width: Mm,
  height: Mm,
  fontSize: z.number().min(6).max(40),
  /** Prefijo fijo delante del valor: "Total: ". No forma parte de la cita literal. */
  prefix: z.string().max(60).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type FieldSlot = z.infer<typeof FieldSlotSchema>;

export const TemplateSchema = z.strictObject({
  id: z.enum(["factura_co", "invoice_en", "nota_cobro_mx", "factura_eu", "otro_documento"]),
  description: z.string().min(1).max(200),
  /** Idioma y convención de formato de montos y fechas. */
  locale: z.enum(["es-CO", "en-US", "es-MX", "de-DE"]),
  page: z.strictObject({ width: Mm, height: Mm }),
  labels: z.array(LabelSchema).max(40),
  fields: z.array(FieldSlotSchema).min(1).max(30),
});
export type DocumentTemplate = z.infer<typeof TemplateSchema>;

const IsoDate = z.iso.date();

/** Lo que el documento dice. Los montos van en unidad mínima de `currency`. */
export const CaseDocumentSchema = z.strictObject({
  /** Clave del vendor de la semilla, o un nombre libre para beneficiarios desconocidos. */
  vendor_key: z.string().min(1).max(50).nullable(),
  payee_name: z.string().min(1).max(200),
  payee_tax_id: z.string().min(1).max(50).nullable(),
  invoice_number: z.string().min(1).max(50),
  issue_date: IsoDate,
  due_date: IsoDate.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotal: z.number().int().min(0).nullable(),
  taxes: z.number().int().min(0).nullable(),
  total: z.number().int().positive(),
  /** Monto en letras, si el documento lo trae. Puede contradecir al numérico a propósito. */
  total_in_words: z.string().max(300).nullable(),
  bank_account: z.string().max(64).nullable(),
  bank_holder: z.string().max(200).nullable(),
  hours: z.number().int().min(0).nullable(),
  purchase_order: z.string().max(50).nullable(),
  description: z.string().min(1).max(300),
  /** Texto adicional que el documento muestra (segundo total, nota, instrucción inyectada). */
  extra: z.string().max(500).nullable(),
  /** Texto que se pinta en blanco: invisible a la vista, presente en la capa de texto. */
  hidden_text: z.string().max(500).nullable(),
});
export type CaseDocument = z.infer<typeof CaseDocumentSchema>;

export const CaseFormatSchema = z.enum(["pdf", "png", "email", "chat", "not_invoice"]);

export const ExpectedSchema = z.strictObject({
  verdict: VerdictSchema,
  /** Regla principal que explica el veredicto; null cuando es pagar. */
  rule: RuleCodeSchema.nullable(),
  reason: z.string().min(1).max(300),
});

export const CaseSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .max(60),
  group: z.enum(["normal", "trampa", "adversarial"]),
  template: TemplateSchema.shape.id,
  format: CaseFormatSchema,
  /** Para `png`, `email` y `chat` duplicados: el caso cuyo PDF se reutiliza como base. */
  same_document_as: z.string().max(60).nullable(),
  document: CaseDocumentSchema,
  /** Correo o chat que acompaña al documento: remitente, fecha y cuerpo. */
  channel: z
    .strictObject({
      from: z.string().min(1).max(200),
      sent_at: z.iso.datetime(),
      subject: z.string().max(200).nullable(),
      body: z.string().max(2000),
    })
    .nullable(),
  expected: ExpectedSchema,
});
export type DatasetCase = z.infer<typeof CaseSchema>;

export const ManifestSchema = z
  .strictObject({
    /** Debe ser `DATASET_TODAY`: el caso de uso de la demo evalúa con esta fecha, no con el reloj. */
    today: IsoDate,
    /**
     * Presupuesto del mes ya comprometido antes de procesar el dataset, en USD. Calibrado
     * para que, pagadas las normales en el orden del manifiesto, queden unos 10.000 USD:
     * más que `sobre_umbral` (escala por umbral, no por presupuesto) y menos que
     * `presupuesto`, que por eso va después de las normales. La prueba dataset contra motor
     * lo comprueba caso por caso.
     */
    october_committed_usd_cents: z.number().int().min(0),
    cases: z.array(CaseSchema).min(1).max(100),
  })
  .superRefine((m, ctx) => {
    if (m.today !== DATASET_TODAY) {
      ctx.addIssue({ code: "custom", path: ["today"], message: `debe ser ${DATASET_TODAY}` });
    }
    const ids = new Set<string>();
    m.cases.forEach((c, i) => {
      if (ids.has(c.id))
        ctx.addIssue({ code: "custom", path: ["cases", i, "id"], message: "id repetido" });
      ids.add(c.id);
      if (c.same_document_as !== null && !m.cases.some((o) => o.id === c.same_document_as)) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", i, "same_document_as"],
          message: "caso base inexistente",
        });
      }
      if ((c.format === "email" || c.format === "chat") && c.channel === null) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", i, "channel"],
          message: "correo y chat llevan canal",
        });
      }
      if (c.expected.verdict === "pagar" && c.expected.rule !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", i, "expected"],
          message: "pagar no lleva regla",
        });
      }
      if (c.expected.verdict !== "pagar" && c.expected.rule === null) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", i, "expected"],
          message: "frenar y escalar llevan regla",
        });
      }
    });
  });
export type Manifest = z.infer<typeof ManifestSchema>;

/** Factura anterior ya decidida, para sembrar historial, ledger y métricas. */
export const HistoryEntrySchema = z.strictObject({
  vendor_key: z.string().min(1).max(50),
  invoice_number: z.string().min(1).max(50),
  received_at: z.iso.datetime(),
  currency: CurrencySchema,
  amount: z.number().int().positive(),
  verdict: VerdictSchema,
  /** Resolución humana si fue escalada. */
  resolution: z.enum(["aprobada", "rechazada"]).nullable(),
  /**
   * La regla que la frenó o escaló, si no se pagó. La semilla escribe su hallazgo con los
   * mismos valores y palabras que el motor; por eso solo se admiten las que sabe escribir.
   */
  rule: z.enum(["bank_account_mismatch", "amount_over_approval_threshold"]).nullable(),
  /** Cuenta que trae el documento, si no es la registrada del beneficiario. */
  bank_account: z.string().min(4).max(40).nullable(),
});
export const HistorySchema = z.array(HistoryEntrySchema).max(500);
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

/** Verdad esperada generada: por caso, archivo, hash, campos con su literal y su posición. */
export const GroundTruthSchema = z.strictObject({
  generated_with: z.strictObject({
    manifest_hash: z.string(),
    templates_hash: z.string(),
    history_hash: z.string(),
  }),
  today: IsoDate,
  cases: z.array(
    z.strictObject({
      id: z.string(),
      group: CaseSchema.shape.group,
      format: CaseFormatSchema,
      file: z.string(),
      document_hash: z.string().regex(/^[0-9a-f]{64}$/),
      /** Archivo PDF del que se derivó un PNG o un adjunto, si aplica. */
      base_file: z.string().nullable(),
      expected: ExpectedSchema,
      fields: z.array(
        z.strictObject({
          name: TemplateFieldNameSchema,
          /** Cadena exacta pintada en el documento. */
          literal: z.string(),
          page: z.number().int().min(1),
          /** Posición en milímetros desde la esquina superior izquierda. */
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }),
      ),
    }),
  ),
  /** El PDF de cada factura del historial, pintado con la plantilla de su beneficiario. */
  history: z.array(
    z.strictObject({
      id: z.string(),
      invoice_number: z.string(),
      file: z.string(),
      document_hash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});
export type GroundTruth = z.infer<typeof GroundTruthSchema>;

/**
 * Lo que la semilla necesita de cada factura del historial para mostrarla como las del lote:
 * su documento ya renderizado (páginas y posiciones del texto, servidos desde el dataset) y
 * su lectura. Se genera con `npm run dataset`; la semilla solo lo lee.
 */
export const HistoryDocumentSchema = z.strictObject({
  invoice_number: z.string().min(1).max(50),
  document_hash: Sha256Schema,
  file_key: z.string().min(1).max(300),
  size_bytes: z.number().int().positive(),
  text: z.string(),
  page_keys: z.array(z.string().min(1).max(300)).min(1).max(20),
  extraction: ExtractionSchema,
});
export const HistoryDocumentsSchema = z.array(HistoryDocumentSchema).max(500);
export type HistoryDocument = z.infer<typeof HistoryDocumentSchema>;
