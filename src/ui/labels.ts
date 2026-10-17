import type { FindingCode, Verdict } from "@/src/domain";

/**
 * Textos cortos de pantalla (docs/interfaz.md §7). El tipo exige una etiqueta por cada
 * código de hallazgo: una regla nueva sin etiqueta no compila.
 */

/** Veredicto en mayúscula sostenida, como lo muestra el chip. */
export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  pagar: "PAGAR",
  escalar: "ESCALAR",
  frenar: "FRENAR",
};

/** Veredicto en prosa: "pagada", "escalada", "frenada". */
export const VERDICT_PARTICIPLE: Readonly<Record<Verdict, string>> = {
  pagar: "pagada",
  escalar: "escalada",
  frenar: "frenada",
};

/** La regla en pocas palabras, para el chip de veredicto. */
export const RULE_SHORT_LABEL: Readonly<Record<FindingCode, string>> = {
  payee_not_allowed: "beneficiario no permitido",
  bank_account_mismatch: "cuenta no coincide",
  account_holder_mismatch: "titular no coincide",
  vendor_not_verified: "beneficiario sin verificar",
  vendor_velocity: "demasiadas facturas",
  amount_over_hard_limit: "supera el límite",
  amount_over_approval_threshold: "supera el umbral",
  budget_exceeded: "sin presupuesto",
  insufficient_balance: "saldo insuficiente",
  duplicate_invoice: "duplicada",
  amount_mismatch: "no cuadra con lo acordado",
  first_payment_to_vendor: "primer pago",
  amount_unusual_for_vendor: "monto atípico",
  unsupported_currency_or_rail: "moneda no soportada",
  due_date_window: "vencida",
  field_low_confidence: "lectura dudosa",
  field_ambiguous: "dato ambiguo",
  evidence_missing: "sin evidencia",
  totals_mismatch: "totales no cuadran",
  suspicious_instructions: "instrucciones sospechosas",
  extraction_unreadable: "no se pudo leer",
  payments_disabled: "pagos apagados",
  autonomy_recomendar: "modo recomendar",
  policy_missing: "sin política",
  vendors_missing: "sin beneficiarios",
  ledger_missing: "sin presupuesto registrado",
  rule_error: "error de regla",
  processing_error: "error de proceso",
};
