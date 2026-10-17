import type { ChecklistItem, Finding, FindingCode } from "@/src/domain";
import { FindingCodeSchema } from "@/src/domain";

import { quote, sanitizeDocumentText } from "./sanitize";

/**
 * Plantillas en español por código de hallazgo. Cada una produce:
 * - `explain`: una frase para la explicación, con valor observado y umbral.
 * - `check`: lo que la persona confirma al aprobar; null si no hay nada que confirmar.
 *
 * Los valores observados pueden traer texto del documento, por eso pasan por `sanitize`.
 * Los umbrales salen de la política y del sistema, pero se sanean igual por uniformidad.
 */

type Template = {
  readonly explain: (f: Finding) => string;
  readonly check: ((f: Finding) => string) | null;
};

const s = sanitizeDocumentText;

export const TEMPLATES: Readonly<Record<FindingCode, Template>> = {
  payee_not_allowed: {
    explain: (f) =>
      `El beneficiario ${quote(f.observed)} no está en la lista permitida (${s(f.threshold)}).`,
    check: (f) => `Confirmo que ${quote(f.observed)} es un proveedor legítimo y lo doy de alta`,
  },
  bank_account_mismatch: {
    explain: (f) =>
      `La cuenta del documento termina en ${s(f.observed)} y la registrada ${s(f.threshold)}.`,
    check: () => "Confirmé el cambio de cuenta con el proveedor por un canal distinto al documento",
  },
  account_holder_mismatch: {
    explain: (f) =>
      `El titular de la cuenta es ${quote(f.observed)}; el registrado es ${quote(f.threshold)}.`,
    check: () => "Confirmé con el proveedor quién es el titular de la cuenta",
  },
  vendor_not_verified: {
    explain: (f) => `El beneficiario está ${s(f.observed)}; hace falta que esté ${s(f.threshold)}.`,
    check: () => "Verifiqué la identidad y los datos de pago del beneficiario",
  },
  vendor_velocity: {
    explain: (f) => `Hay ${s(f.observed)}; el máximo es ${s(f.threshold)}.`,
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
    explain: (f) => `Hay ${s(f.observed)}; el presupuesto es ${s(f.threshold)}.`,
    check: () => "Acepto que este pago supere el presupuesto del periodo",
  },
  insufficient_balance: {
    explain: (f) => `El ${s(f.observed)} y el pago necesita ${s(f.threshold)}.`,
    check: null,
  },
  duplicate_invoice: {
    explain: (f) => `Parece ${s(f.observed)}; se exige ${s(f.threshold)}.`,
    check: () => "Revisé la factura anterior y confirmo que esta es un cobro distinto",
  },
  amount_mismatch: {
    explain: (f) => `El monto es ${s(f.observed)}; lo acordado es ${s(f.threshold)}.`,
    check: () => "Confirmo que la diferencia frente a lo acordado es correcta",
  },
  first_payment_to_vendor: {
    explain: (f) => `Este beneficiario tiene ${s(f.observed)}; se pide ${s(f.threshold)}.`,
    check: () => "Confirmo que es la primera vez que pagamos a este beneficiario y que está bien",
  },
  amount_unusual_for_vendor: {
    explain: (f) => `El monto es ${s(f.observed)}; lo habitual es ${s(f.threshold)}.`,
    check: () => "Confirmo que este monto, distinto de lo habitual, es correcto",
  },
  unsupported_currency_or_rail: {
    explain: (f) =>
      `Se pide pagar en ${s(f.observed)}; las rutas disponibles son ${s(f.threshold)}.`,
    check: null,
  },
  due_date_window: {
    explain: (f) => `La factura está ${s(f.observed)}; el atraso admitido es ${s(f.threshold)}.`,
    check: () => "Confirmo que esta factura vencida sigue pendiente de pago y debe pagarse",
  },
  field_low_confidence: {
    explain: (f) =>
      `La lectura de ${s(f.observed)} está por debajo de la confianza mínima ${s(f.threshold)}.`,
    check: (f) => `Revisé el campo ${s(f.field ?? "indicado")} contra el documento`,
  },
  field_ambiguous: {
    explain: (f) =>
      `El documento muestra más de un valor para ${s(f.observed)}; se exige ${s(f.threshold)}.`,
    check: (f) => `Elegí el valor correcto para ${s(f.field ?? "el campo ambiguo")}`,
  },
  evidence_missing: {
    explain: (f) =>
      `No se encontró en el documento la cita de ${s(f.observed)}; se exige ${s(f.threshold)}.`,
    check: (f) => `Verifiqué el campo ${s(f.field ?? "indicado")} directamente en el documento`,
  },
  totals_mismatch: {
    explain: (f) => `Los totales no cuadran: ${s(f.observed)} frente a ${s(f.threshold)}.`,
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
    explain: (f) =>
      `Los pagos están apagados (${s(f.observed)}); se necesita el ${s(f.threshold)}.`,
    check: () => "Autorizo este pago aunque los pagos automáticos estén apagados",
  },
  autonomy_recomendar: {
    explain: (f) =>
      `La empresa fijó ${s(f.observed)}; el agente solo recomienda hasta pasar a ${s(f.threshold)}.`,
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
      `No hay registro de presupuesto (${s(f.observed)}); se necesita ${s(f.threshold)}.`,
    check: null,
  },
  rule_error: {
    explain: (f) => `Una regla no pudo evaluarse (${s(f.observed)}); se exige ${s(f.threshold)}.`,
    check: null,
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

/** Comprobación para la prueba P-34: toda regla del catálogo tiene plantilla. */
export function templateCodes(): readonly FindingCode[] {
  return FindingCodeSchema.options.filter((code) => code in TEMPLATES);
}
