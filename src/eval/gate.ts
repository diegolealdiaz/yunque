import type { Metrics } from "./metrics";

/**
 * Puerta del set de regresión: umbrales decididos antes de medir (`practicas.md` 67). Si
 * alguno falla, `npm run eval` sale en rojo y CI no despliega.
 *
 * - Falsos "pagar": cero. Es el único criterio descalificante del reto.
 * - Exactitud de los campos críticos (a quién, cuánto, en qué moneda, qué factura): 99 %.
 * - Escalado sobre las facturas normales: como máximo el valor calibrado en el paso 18.
 *   Hasta entonces, el del Lector ideal: ninguna normal escala.
 * - Con fixtures, ninguna petición sin grabar.
 */
export const EVAL_THRESHOLDS = {
  maxFalsePay: 0,
  minCriticalFieldAccuracy: 0.99,
  criticalFields: ["payee_name", "total", "currency", "invoice_number"],
  maxNormalEscalationRate: 0,
} as const;

export type GateResult = { readonly passed: boolean; readonly failures: readonly string[] };

export function evaluateGate(metrics: Metrics, missingFixtures: number): GateResult {
  const failures: string[] = [];
  if (metrics.false_pay.length > EVAL_THRESHOLDS.maxFalsePay) {
    failures.push(`falsos pagar: ${metrics.false_pay.join(", ")}`);
  }
  for (const field of EVAL_THRESHOLDS.criticalFields) {
    const accuracy = metrics.field_accuracy[field];
    if (accuracy && accuracy.rate < EVAL_THRESHOLDS.minCriticalFieldAccuracy) {
      failures.push(`exactitud de ${field}: ${String(accuracy.hits)}/${String(accuracy.total)}`);
    }
  }
  if (metrics.escalation_on_normals.rate > EVAL_THRESHOLDS.maxNormalEscalationRate) {
    const e = metrics.escalation_on_normals;
    failures.push(`escalado sobre normales: ${String(e.hits)}/${String(e.total)}`);
  }
  if (missingFixtures > 0) failures.push(`peticiones sin fixture: ${String(missingFixtures)}`);
  return { passed: failures.length === 0, failures };
}
