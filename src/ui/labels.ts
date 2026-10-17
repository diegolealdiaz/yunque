// Solo el catálogo de reglas y tipos: estas etiquetas también viajan al navegador, y el
// índice del dominio arrastra `node:crypto`.
import type {
  Channel,
  ExtractedFieldName,
  FindingCode,
  InvoiceStatus,
  Verdict,
} from "@/src/domain";
import { RULES, RuleCodeSchema } from "@/src/domain/rules";

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
  human_correction: "corregida a mano",
};

/** Nombre de cada campo leído, como lo ve la persona. */
export const FIELD_LABEL: Readonly<Record<ExtractedFieldName, string>> = {
  payee_name: "Beneficiario",
  payee_tax_id: "Identificación",
  invoice_number: "Número",
  issue_date: "Emitida",
  due_date: "Vence",
  currency: "Moneda",
  subtotal: "Subtotal",
  taxes: "Impuestos",
  total: "Monto",
  bank_account: "Cuenta",
  bank_holder: "Titular",
  hours: "Horas",
  purchase_order: "Orden de compra",
  description: "Concepto",
};

/** Canal de llegada, en palabras. */
export const CHANNEL_LABEL: Readonly<Record<Channel, string>> = {
  upload: "subida en pantalla",
  batch: "lote del periodo",
  inbox: "bandeja de correo",
  telegram: "Telegram",
  api: "API de decisión",
};

/** Título de los hallazgos de sistema, que no son reglas del catálogo. */
const SYSTEM_TITLE: Readonly<Record<string, string>> = {
  payments_disabled: "Pagos apagados",
  autonomy_recomendar: "Autonomía en recomendar",
  policy_missing: "Sin política vigente",
  vendors_missing: "Sin lista de beneficiarios",
  ledger_missing: "Sin presupuesto del periodo",
  rule_error: "Una regla no pudo evaluarse",
  processing_error: "Error de procesamiento",
  human_correction: "Campos corregidos a mano",
};

/** Título de cada regla o hallazgo de sistema para la traza del detalle. */
export function ruleTitle(code: FindingCode): string {
  const rule = RuleCodeSchema.safeParse(code);
  return rule.success ? RULES[rule.data].title : (SYSTEM_TITLE[code] ?? code);
}

/** Estado de la factura, en palabras de producto. */
export const STATUS_LABEL: Readonly<Record<InvoiceStatus, string>> = {
  recibida: "recibida",
  procesando: "leyendo",
  decidida: "decidida",
  esperando_aprobacion: "espera tu decisión",
  aprobada: "aprobada",
  rechazada: "rechazada",
  fallida: "falló, reintentar",
};
