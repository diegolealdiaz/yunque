import { formatMoney, isPresent, money, type Currency } from "@/src/domain";

import { fail, pass, skipped, type Rule } from "./types";
import { currencyOf, evidenceOf, fieldsOf } from "./shared";

/**
 * Reglas sobre la lectura: si la factura se entendió, con qué confianza y con qué evidencia.
 * Las banderas del modelo (sospechas, ambigüedades) solo pueden endurecer el veredicto.
 */

export const extractionUnreadable: Rule = {
  code: "extraction_unreadable",
  evaluate: (ctx) => {
    if (ctx.extraction.kind === "invoice") return pass;
    const observed = ctx.extraction.kind === "not_invoice" ? "no es una factura" : "ilegible";
    return fail({
      code: "extraction_unreadable",
      action: "escalar",
      observed,
      threshold: "factura legible",
      message:
        ctx.extraction.kind === "not_invoice"
          ? `El documento no parece una factura: ${ctx.extraction.reason}`
          : `No se pudo leer el documento: ${ctx.extraction.reason}`,
    });
  },
};

export const suspiciousInstructions: Rule = {
  code: "suspicious_instructions",
  evaluate: (ctx) => {
    const fromModel = ctx.extraction.kind === "unreadable" ? [] : ctx.extraction.suspicions;
    const all = [...ctx.verification.suspicions, ...fromModel];
    if (all.length === 0) return pass;
    const first = all[0];
    const kinds = [...new Set(all.map((s) => s.kind))].join(", ");
    return fail({
      code: "suspicious_instructions",
      action: "frenar",
      observed: kinds,
      threshold: "sin instrucciones ni texto oculto",
      evidence: first
        ? { literal: first.quote.slice(0, 500), quote: first.quote, page: null }
        : null,
      message: "El documento contiene instrucciones dirigidas al sistema o texto oculto",
    });
  },
};

const CRITICAL_FIELD_MAP = {
  payee_name: "payee_name",
  amount: "total",
  currency: "currency",
  bank_account: "bank_account",
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
          observed: `${name}: ${field.confidence.toFixed(2)}`,
          threshold: `≥ ${min_confidence.toFixed(2)}`,
          field: name,
          evidence: field.evidence,
          message: `La lectura del campo ${name} tiene confianza baja`,
        });
      }
    }
    return pass;
  },
};

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
      observed: `${first.field}: ${first.candidates.join(" | ")}`,
      threshold: "un solo candidato",
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
      observed: missing.join(", "),
      threshold: "toda cita presente en el documento",
      field: first,
      message: `La cita del campo ${first} no aparece en el documento`,
    });
  },
};

/** Tolerancia de redondeo entre subtotal más impuestos y total: una unidad mínima. */
const TOTALS_TOLERANCE = 1;

export const totalsMismatch: Rule = {
  code: "totals_mismatch",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    if (ctx.verification.totals === "not_applicable") return skipped("sin desglose de impuestos");
    if (!isPresent(fields.subtotal) || !isPresent(fields.taxes)) return skipped("sin desglose");
    const sum = fields.subtotal.value + fields.taxes.value;
    const diff = Math.abs(sum - fields.total.value);
    if (ctx.verification.totals === "ok" && diff <= TOTALS_TOLERANCE) return pass;
    const currency: Currency | null = currencyOf(ctx);
    const fmt = (n: number) => (currency ? formatMoney(money(n, currency)) : String(n));
    return fail({
      code: "totals_mismatch",
      action: "escalar",
      observed: `${fmt(fields.subtotal.value)} + ${fmt(fields.taxes.value)} = ${fmt(sum)}`,
      threshold: `total ${fmt(fields.total.value)}`,
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
