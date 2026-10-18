import {
  ExtractedFieldNameSchema,
  FIELD_PHRASE,
  type ChecklistItem,
  type Finding,
  type FindingCode,
} from "@/src/domain";

import { quote, sanitizeDocumentText } from "./sanitize";

/**
 * Plantillas en español por código de hallazgo. Cada una produce:
 * - `explain`: una frase que informa, en tercera persona, con valor observado y umbral.
 * - `check`: lo que la persona confirma al aprobar, en primera persona; null si la regla
 *   no admite confirmación humana (los frenos duros se corrigen y se reprocesan).
 *
 * `observed` y `threshold` llegan como valores desnudos y pasan por `sanitize`, porque
 * pueden traer texto del documento. Los conectores los pone la plantilla.
 */

type Template = {
  readonly explain: (f: Finding) => string;
  readonly check: ((f: Finding) => string) | null;
};

const s = sanitizeDocumentText;

/** El campo de un hallazgo en palabras, o `fallback` si no es un campo conocido. */
function fieldName(f: Finding, fallback: string): string {
  const parsed = ExtractedFieldNameSchema.safeParse(f.field);
  return parsed.success ? FIELD_PHRASE[parsed.data] : fallback;
}

export const TEMPLATES: Readonly<Record<FindingCode, Template>> = {
  payee_not_allowed: {
    explain: (f) => `El beneficiario ${quote(f.observed)} no está en la ${s(f.threshold)}.`,
    check: (f) => `Confirmo que ${quote(f.observed)} es un proveedor legítimo y lo doy de alta`,
  },
  bank_account_mismatch: {
    explain: (f) =>
      `La cuenta del documento termina en ${s(f.observed)} y la registrada en ${s(f.threshold)}.`,
    check: () => "Confirmé el cambio de cuenta con el proveedor por un canal distinto al documento",
  },
  account_holder_mismatch: {
    explain: (f) =>
      `El titular de la cuenta es ${quote(f.observed)}; el registrado es ${quote(f.threshold)}.`,
    check: () => "Confirmé con el proveedor quién es el titular de la cuenta",
  },
  vendor_not_verified: {
    explain: (f) => `El beneficiario está ${s(f.observed)}; debe estar ${s(f.threshold)}.`,
    check: () => "Verifiqué la identidad y los datos de pago del beneficiario",
  },
  vendor_velocity: {
    explain: (f) => `Hay ${s(f.observed)}; se admiten ${s(f.threshold)}.`,
    check: () => "Confirmo que estas facturas seguidas corresponden a trabajo real",
  },
  amount_over_hard_limit: {
    explain: (f) => `El monto es ${s(f.observed)} y el límite por pago es ${s(f.threshold)}.`,
    check: null,
  },
  amount_over_approval_threshold: {
    explain: (f) =>
      `El monto es ${s(f.observed)}; por encima de ${s(f.threshold)} decide una persona.`,
    check: (f) => `Autorizo este pago de ${s(f.observed)}`,
  },
  budget_exceeded: {
    explain: (f) => `El pago es ${s(f.observed)}; el presupuesto es ${s(f.threshold)}.`,
    check: () => "Acepto que este pago supere el presupuesto del periodo",
  },
  insufficient_balance: {
    explain: (f) => `El saldo disponible es ${s(f.observed)} y el pago necesita ${s(f.threshold)}.`,
    check: null,
  },
  duplicate_invoice: {
    explain: (f) => `Parece ${s(f.observed)}; se espera ${s(f.threshold)}.`,
    check: () => "Revisé la factura anterior y confirmo que esta es un cobro distinto",
  },
  amount_mismatch: {
    explain: (f) => `La factura trae ${s(f.observed)}; lo acordado es ${s(f.threshold)}.`,
    check: () => "Confirmo que la diferencia frente a lo acordado es correcta",
  },
  first_payment_to_vendor: {
    explain: (f) => `Este beneficiario tiene ${s(f.observed)}; se espera ${s(f.threshold)}.`,
    check: () => "Confirmo que es la primera vez que pagamos a este beneficiario y que está bien",
  },
  amount_unusual_for_vendor: {
    explain: (f) => `El monto es ${s(f.observed)}; lo habitual es ${s(f.threshold)}.`,
    check: () => "Confirmo que este monto, distinto de lo habitual, es correcto",
  },
  unsupported_currency_or_rail: {
    explain: (f) => `Se pide pagar en ${s(f.observed)}; lo disponible es ${s(f.threshold)}.`,
    check: null,
  },
  due_date_window: {
    explain: (f) => `La factura está ${s(f.observed)}; el atraso admitido es de ${s(f.threshold)}.`,
    check: () => "Confirmo que esta factura vencida sigue pendiente de pago y debe pagarse",
  },
  field_low_confidence: {
    explain: (f) =>
      `La lectura de ${fieldName(f, "un campo")} tiene confianza ${s(f.observed)}; el mínimo es ${s(f.threshold)}.`,
    check: (f) => `Revisé ${fieldName(f, "el campo indicado")} contra el documento`,
  },
  field_ambiguous: {
    explain: (f) =>
      `Para ${fieldName(f, "un campo")} el documento muestra ${s(f.observed)}; se espera ${s(f.threshold)}.`,
    check: (f) => `Elegí el valor correcto para ${fieldName(f, "el campo ambiguo")}`,
  },
  evidence_missing: {
    explain: (f) =>
      `La cita de ${s(f.observed)} no aparece en el documento o no respalda el valor leído; se exige ${s(f.threshold)}.`,
    check: (f) => `Verifiqué ${fieldName(f, "el campo indicado")} directamente en el documento`,
  },
  totals_mismatch: {
    explain: (f) => `El desglose suma ${s(f.observed)}, pero el total es ${s(f.threshold)}.`,
    check: () => "Revisé el desglose y confirmo el total a pagar",
  },
  suspicious_instructions: {
    explain: (f) =>
      `El documento contiene ${s(f.observed)}; se exige un documento ${s(f.threshold)}.`,
    check: null,
  },
  extraction_unreadable: {
    explain: (f) => `El documento resultó ${s(f.observed)}; se necesita una ${s(f.threshold)}.`,
    check: () => "Leí el documento y completé los campos a mano",
  },
  payments_disabled: {
    explain: (f) => `Los pagos automáticos están ${s(f.observed)}; deben estar ${s(f.threshold)}.`,
    check: () => "Autorizo este pago aunque los pagos automáticos estén apagados",
  },
  autonomy_recomendar: {
    explain: (f) =>
      `La autonomía configurada es ${s(f.observed)}: el agente propone y una persona decide; para que pague solo debe ser ${s(f.threshold)}.`,
    check: () => "Confirmo la recomendación del agente",
  },
  policy_missing: {
    explain: (f) => `No hay política vigente (${s(f.observed)}); se necesita ${s(f.threshold)}.`,
    check: null,
  },
  vendors_missing: {
    explain: (f) =>
      `No hay lista de beneficiarios (${s(f.observed)}); se necesita ${s(f.threshold)}.`,
    check: null,
  },
  ledger_missing: {
    explain: (f) =>
      `El registro de presupuesto disponible es ${s(f.observed)}; se necesita ${s(f.threshold)}.`,
    check: null,
  },
  rule_error: {
    explain: (f) => `Una regla no pudo evaluarse (${s(f.observed)}); se exige ${s(f.threshold)}.`,
    check: null,
  },
  human_correction: {
    explain: (f) =>
      `Una persona corrigió a mano ${s(f.observed)}; para pagar se necesita ${s(f.threshold)}.`,
    check: () => "Revisé contra el documento los campos que otra persona corrigió a mano",
  },
  processing_error: {
    explain: (f) =>
      `El procesamiento se interrumpió en ${s(f.observed)}; se necesita ${s(f.threshold)}.`,
    check: () => "Revisé el documento y los campos a mano; el error de proceso no cambia el pago",
  },
};

/** Frase de explicación para un hallazgo. */
export function explainFinding(finding: Finding): string {
  return TEMPLATES[finding.code].explain(finding);
}

/** Punto de checklist derivado del hallazgo, o null si la regla no admite confirmación humana. */
export function checklistItemFor(finding: Finding): ChecklistItem | null {
  const template = TEMPLATES[finding.code].check;
  if (!template) return null;
  return { code: finding.code, text: template(finding), checked: false };
}
