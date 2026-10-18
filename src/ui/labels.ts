// Solo el catálogo de reglas y tipos: estas etiquetas también viajan al navegador, y el
// índice del dominio arrastra `node:crypto`.
import type {
  Channel,
  EventType,
  ExtractedFieldName,
  FindingCode,
  InvoiceStatus,
  Rail,
  Verdict,
} from "@/src/domain";
import { RAIL_NAME } from "@/src/domain/currency";
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
  extraction_unreadable: "no es factura o ilegible",
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

/** Canal en una palabra, para la columna de las tablas. */
export const CHANNEL_SHORT_LABEL: Readonly<Record<Channel, string>> = {
  upload: "Subida",
  batch: "Lote",
  inbox: "Correo",
  telegram: "Telegram",
  api: "API",
};

/** Cómo llegó la factura, como frase del encabezado del detalle: «Llegó por correo». */
export const ARRIVAL_LABEL: Readonly<Record<Channel, string>> = {
  upload: "Subida en pantalla",
  batch: "Llegó en el lote",
  inbox: "Llegó por correo",
  telegram: "Llegó por Telegram",
  api: "Llegó por la API",
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

/**
 * Por qué se frenó o escaló, en una frase para el cliente, sin los valores: la bitácora solo
 * guarda el código de la regla que decidió. El detalle de la factura dice los valores.
 */
export const RULE_REASON: Readonly<Record<FindingCode, string>> = {
  payee_not_allowed: "El beneficiario no está en la lista de permitidos",
  bank_account_mismatch: "La cuenta de pago no es la registrada del beneficiario",
  account_holder_mismatch: "El titular de la cuenta no es el beneficiario",
  vendor_not_verified: "El beneficiario todavía no está verificado",
  vendor_velocity: "Demasiadas facturas seguidas del mismo beneficiario",
  amount_over_hard_limit: "Supera el límite por pago",
  amount_over_approval_threshold: "Supera el monto que el agente paga solo",
  budget_exceeded: "No cabe en el presupuesto del periodo",
  insufficient_balance: "No hay saldo suficiente en la cuenta origen",
  duplicate_invoice: "La misma factura ya había llegado",
  amount_mismatch: "Cobra distinto a lo acordado con el beneficiario",
  first_payment_to_vendor: "Es el primer pago a este beneficiario",
  amount_unusual_for_vendor: "El monto se sale de lo que se le suele pagar",
  unsupported_currency_or_rail: "No se puede pagar en esa moneda o a esa cuenta",
  due_date_window: "Lleva demasiado tiempo vencida",
  field_low_confidence: "El agente no leyó un dato clave con suficiente seguridad",
  field_ambiguous: "Un dato clave aparece con dos valores distintos",
  evidence_missing: "Un dato leído no aparece en el documento",
  totals_mismatch: "Los totales del documento no cuadran",
  suspicious_instructions: "El documento trae instrucciones para el agente",
  extraction_unreadable: "No es una factura o no se pudo leer",
  payments_disabled: "Los pagos estaban apagados",
  autonomy_recomendar: "El agente solo recomienda: decide una persona",
  policy_missing: "No había una política vigente",
  vendors_missing: "No había lista de beneficiarios",
  ledger_missing: "No había presupuesto registrado para el periodo",
  rule_error: "Una regla falló al evaluarse",
  processing_error: "Falló un paso del proceso antes de decidir",
  human_correction: "Una persona corrigió datos a mano",
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

/** Tipo de evento de la bitácora, en palabras de producto. Uno por tipo: uno nuevo sin etiqueta no compila. */
export const EVENT_LABEL: Readonly<Record<EventType, string>> = {
  "invoice.received": "Factura recibida",
  "invoice.processing": "Lectura iniciada",
  "invoice.normalized": "Documento normalizado",
  "invoice.extracted": "Factura leída",
  "invoice.decided": "Decisión del agente",
  "invoice.escalated": "Escalada a una persona",
  "invoice.approved": "Aprobada",
  "invoice.rejected": "Rechazada",
  "invoice.corrected": "Corregida a mano",
  "invoice.failed": "Falló el proceso",
  "policy.saved": "Política firmada",
  "policy.proposed": "Cambio de reglas propuesto",
  "policy.proposal_closed": "Propuesta resuelta",
  "policy.replayed": "Facturas reevaluadas",
  "controls.changed": "Interruptores cambiados",
  "vendor.created": "Beneficiario creado",
  "vendor.verified": "Beneficiario verificado",
  "vendor.account_changed": "Cuenta de beneficiario cambiada",
  "notification.sent": "Aviso enviado",
  "notification.failed": "Aviso fallido",
  "llm.called": "Lectura del documento",
  "llm.failed": "Lectura del documento fallida",
  "email.rejected": "Correo no procesado",
  "explanation.rated": "Opinión sobre la explicación",
};

/** Cómo se le paga a una cuenta registrada, en una palabra corta. */
export const RAIL_LABEL: Readonly<Record<Rail, string>> = RAIL_NAME;
