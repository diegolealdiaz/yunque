import {
  FIELD_PHRASE,
  formatMoney,
  isPresent,
  money,
  unreadableObserved,
  type Currency,
  type Suspicion,
} from "@/src/domain";

import { fail, pass, skipped, type Rule } from "./types";
import { currencyOf, evidenceOf, fieldsOf } from "./shared";

/**
 * Reglas sobre la lectura: si la factura se entendió, con qué confianza y con qué evidencia.
 * Las banderas del modelo (sospechas, ambigüedades) solo pueden endurecer el veredicto.
 *
 * `observed` y `threshold` llevan valores desnudos; los conectores los pone la plantilla.
 * El texto del documento o del modelo solo viaja en `observed` y `evidence`, que se sanean.
 */

export const extractionUnreadable: Rule = {
  code: "extraction_unreadable",
  evaluate: (ctx) => {
    if (ctx.extraction.kind === "invoice") return pass;
    const notInvoice = ctx.extraction.kind === "not_invoice";
    return fail({
      code: "extraction_unreadable",
      action: "escalar",
      observed: unreadableObserved(
        notInvoice ? "not_invoice" : "unreadable",
        ctx.extraction.reason,
      ),
      threshold: "factura legible",
      message: notInvoice ? "El documento no parece una factura" : "No se pudo leer el documento",
    });
  },
};

const SUSPICION_LABEL: Record<Suspicion["kind"], string> = {
  instruction_to_agent: "instrucciones dirigidas al sistema",
  hidden_text: "texto oculto",
  canary: "token canario",
  amount_in_words_differs: "monto en letras distinto del numérico",
};

export const suspiciousInstructions: Rule = {
  code: "suspicious_instructions",
  evaluate: (ctx) => {
    const fromModel = ctx.extraction.kind === "unreadable" ? [] : ctx.extraction.suspicions;
    const all = [...ctx.verification.suspicions, ...fromModel];
    const first = all[0];
    if (!first) return pass;
    const kinds = [...new Set(all.map((s) => SUSPICION_LABEL[s.kind]))].join(", ");
    return fail({
      code: "suspicious_instructions",
      action: "frenar",
      observed: kinds,
      threshold: "sin instrucciones ni texto oculto",
      evidence: { literal: first.quote.slice(0, 500), quote: first.quote, page: null },
      message: "El documento contiene instrucciones dirigidas al sistema o texto oculto",
    });
  },
};

const CRITICAL_FIELD_MAP = {
  payee_name: "payee_name",
  amount: "total",
  currency: "currency",
  bank_account: "bank_account",
  bank_holder: "bank_holder",
  invoice_number: "invoice_number",
  due_date: "due_date",
  hours: "hours",
  purchase_order: "purchase_order",
} as const;

export const fieldLowConfidence: Rule = {
  code: "field_low_confidence",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    const { min_confidence, critical_fields } = ctx.policy.rules.field_low_confidence;
    for (const critical of critical_fields) {
      const name = CRITICAL_FIELD_MAP[critical];
      const field = fields[name];
      if (!isPresent(field)) continue;
      if (field.confidence < min_confidence) {
        return fail({
          code: "field_low_confidence",
          action: "escalar",
          observed: field.confidence.toFixed(2),
          threshold: min_confidence.toFixed(2),
          field: name,
          evidence: field.evidence,
          message: `La lectura del campo ${name} tiene confianza baja`,
        });
      }
    }
    return pass;
  },
};

/** Campos de dinero: sus candidatos llegan en unidad mínima ("850000") y se muestran con moneda. */
const MONEY_FIELDS: ReadonlySet<string> = new Set(["subtotal", "taxes", "total"]);

/** Un candidato como lo lee una persona: "8.500,00 BRL" en vez de "850000". */
function candidateText(field: string, candidate: string, currency: Currency | null): string {
  if (!currency || !MONEY_FIELDS.has(field) || !/^-?\d{1,15}$/.test(candidate)) return candidate;
  return formatMoney(money(Number(candidate), currency));
}

export const fieldAmbiguous: Rule = {
  code: "field_ambiguous",
  evaluate: (ctx) => {
    const fromModel = ctx.extraction.kind === "invoice" ? ctx.extraction.ambiguities : [];
    const all = [...ctx.verification.ambiguities, ...fromModel];
    const first = all[0];
    if (!first) return pass;
    return fail({
      code: "field_ambiguous",
      action: "escalar",
      observed: first.candidates
        .map((c) => candidateText(first.field, c, currencyOf(ctx)))
        .join(" | "),
      threshold: "un solo valor",
      field: first.field,
      message: `El campo ${first.field} tiene más de un valor posible en el documento`,
    });
  },
};

export const evidenceMissing: Rule = {
  code: "evidence_missing",
  evaluate: (ctx) => {
    const missing = ctx.verification.evidence_missing;
    const first = missing[0];
    if (!first) return pass;
    return fail({
      code: "evidence_missing",
      action: "escalar",
      observed: missing.map((name) => FIELD_PHRASE[name]).join(", "),
      threshold: "cita presente en el documento",
      field: first,
      message: `La cita del campo ${first} no aparece en el documento o no respalda el valor leído`,
    });
  },
};

/** Tolerancia de redondeo entre subtotal más impuestos y total: una unidad mínima. */
export const TOTALS_TOLERANCE = 1;

/**
 * Cuadre de totales. El motor hace su propia aritmética sobre los campos leídos y además
 * respeta al Verificador: falla si cualquiera de los dos detecta diferencia.
 */
export const totalsMismatch: Rule = {
  code: "totals_mismatch",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    if (!isPresent(fields.subtotal) || !isPresent(fields.taxes)) {
      return skipped("sin desglose de impuestos");
    }
    const sum = fields.subtotal.value + fields.taxes.value;
    const diff = Math.abs(sum - fields.total.value);
    if (diff <= TOTALS_TOLERANCE && ctx.verification.totals !== "mismatch") return pass;
    const currency: Currency | null = currencyOf(ctx);
    const fmt = (n: number) => (currency ? formatMoney(money(n, currency)) : String(n));
    return fail({
      code: "totals_mismatch",
      action: "escalar",
      observed: `${fmt(fields.subtotal.value)} + ${fmt(fields.taxes.value)} = ${fmt(sum)}`,
      threshold: fmt(fields.total.value),
      field: "total",
      evidence: evidenceOf(ctx, "total"),
      message: "Subtotal más impuestos no cuadra con el total",
    });
  },
};

export const EXTRACTION_RULES: readonly Rule[] = [
  extractionUnreadable,
  suspiciousInstructions,
  fieldLowConfidence,
  fieldAmbiguous,
  evidenceMissing,
  totalsMismatch,
];
