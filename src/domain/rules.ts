import { z } from "zod";

/**
 * Catálogo de reglas. Cada regla tiene un código estable que aparece en hallazgos,
 * política, bitácora y pantalla. El motor (`src/engine`) implementa la evaluación;
 * aquí solo viven los códigos, su acción por defecto y el texto que la pantalla muestra.
 */

export const RULE_CODES = [
  "payee_not_allowed",
  "bank_account_mismatch",
  "account_holder_mismatch",
  "vendor_not_verified",
  "vendor_velocity",
  "amount_over_hard_limit",
  "amount_over_approval_threshold",
  "budget_exceeded",
  "insufficient_balance",
  "duplicate_invoice",
  "recurring_period_repeat",
  "amount_mismatch",
  "first_payment_to_vendor",
  "amount_unusual_for_vendor",
  "unsupported_currency_or_rail",
  "due_date_window",
  "field_low_confidence",
  "field_ambiguous",
  "evidence_missing",
  "totals_mismatch",
  "suspicious_instructions",
  "extraction_unreadable",
] as const;
export const RuleCodeSchema = z.enum(RULE_CODES);
export type RuleCode = z.infer<typeof RuleCodeSchema>;

/**
 * Hallazgos que no son reglas de la política pero sí aparecen en decisiones:
 * - `payments_disabled`: el interruptor de pagos está apagado (invariante 9).
 * - `autonomy_recomendar`: la empresa pidió que toda decisión pase por una persona.
 * - `policy_missing`, `vendors_missing`, `ledger_missing`: falta un artefacto (invariante 11).
 * - `rule_error`: una regla lanzó; el veredicto por defecto es frenar (invariante 11).
 * - `processing_error`: una etapa del caso de uso falló antes de decidir (normalización,
 *   lectura, resolución); la factura escala con el error como motivo, nunca se paga.
 * - `human_correction`: una persona corrigió campos a mano. Lo que pagaría queda para que
 *   otra persona lo apruebe: quien corrige no libera su propia corrección (cuatro ojos).
 */
export const SYSTEM_FINDING_CODES = [
  "payments_disabled",
  "autonomy_recomendar",
  "policy_missing",
  "vendors_missing",
  "ledger_missing",
  "rule_error",
  "processing_error",
  "human_correction",
] as const;
export const SystemFindingCodeSchema = z.enum(SYSTEM_FINDING_CODES);

export const FindingCodeSchema = z.enum([...RULE_CODES, ...SYSTEM_FINDING_CODES]);
export type FindingCode = z.infer<typeof FindingCodeSchema>;

export const OnFailSchema = z.enum(["frenar", "escalar"]);
export type OnFail = z.infer<typeof OnFailSchema>;

type RuleMeta = {
  readonly title: string;
  readonly defaultOnFail: OnFail;
  /** Si es falso, la empresa no puede cambiar la acción desde el formulario. */
  readonly configurable: boolean;
};

export const RULES: Readonly<Record<RuleCode, RuleMeta>> = {
  payee_not_allowed: {
    title: "Beneficiario permitido",
    defaultOnFail: "escalar",
    configurable: true,
  },
  bank_account_mismatch: {
    title: "Cuenta distinta a la registrada",
    defaultOnFail: "frenar",
    configurable: false,
  },
  account_holder_mismatch: {
    title: "Titular de la cuenta no coincide",
    defaultOnFail: "frenar",
    configurable: false,
  },
  vendor_not_verified: {
    title: "Beneficiario sin verificar",
    defaultOnFail: "escalar",
    configurable: false,
  },
  vendor_velocity: {
    title: "Demasiadas facturas del mismo beneficiario",
    defaultOnFail: "escalar",
    configurable: true,
  },
  amount_over_hard_limit: {
    title: "Límite por pago",
    defaultOnFail: "frenar",
    configurable: false,
  },
  amount_over_approval_threshold: {
    title: "Umbral de aprobación humana",
    defaultOnFail: "escalar",
    configurable: false,
  },
  budget_exceeded: {
    title: "Presupuesto del periodo",
    defaultOnFail: "frenar",
    configurable: true,
  },
  insufficient_balance: { title: "Saldo disponible", defaultOnFail: "frenar", configurable: false },
  duplicate_invoice: { title: "Factura duplicada", defaultOnFail: "frenar", configurable: true },
  recurring_period_repeat: {
    title: "Segundo cobro de un recurrente en el periodo",
    defaultOnFail: "escalar",
    configurable: false,
  },
  amount_mismatch: {
    title: "No cuadra con lo acordado",
    defaultOnFail: "escalar",
    configurable: true,
  },
  first_payment_to_vendor: {
    title: "Primer pago a un beneficiario",
    defaultOnFail: "escalar",
    configurable: true,
  },
  amount_unusual_for_vendor: {
    title: "Monto atípico para el beneficiario",
    defaultOnFail: "escalar",
    configurable: true,
  },
  unsupported_currency_or_rail: {
    title: "Moneda o ruta no soportada",
    defaultOnFail: "frenar",
    configurable: false,
  },
  due_date_window: { title: "Fecha de vencimiento", defaultOnFail: "escalar", configurable: true },
  field_low_confidence: {
    title: "Confianza de lectura baja",
    defaultOnFail: "escalar",
    configurable: false,
  },
  field_ambiguous: {
    title: "Campo con dos candidatos",
    defaultOnFail: "escalar",
    configurable: false,
  },
  evidence_missing: {
    title: "Cita no encontrada en el documento",
    defaultOnFail: "escalar",
    configurable: false,
  },
  totals_mismatch: {
    title: "Los totales no cuadran",
    defaultOnFail: "escalar",
    configurable: false,
  },
  suspicious_instructions: {
    title: "Instrucciones sospechosas en el documento",
    defaultOnFail: "frenar",
    configurable: false,
  },
  extraction_unreadable: {
    title: "No se pudo leer la factura",
    defaultOnFail: "escalar",
    configurable: false,
  },
};

export const CONFIGURABLE_RULES: readonly RuleCode[] = RULE_CODES.filter(
  (c) => RULES[c].configurable,
);

/** Reglas con la acción de fábrica: la política no las puede ablandar. */
export const FIXED_RULES: readonly RuleCode[] = RULE_CODES.filter((c) => !RULES[c].configurable);
