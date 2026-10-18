import type { Verdict } from "@/src/domain";
import { formatMoney, isSupportedCurrency, money } from "@/src/domain";
import { loadExpectedCases } from "@/src/dataset/demo-seed";

/**
 * Lo que la portada cuenta del lote de ejemplo, leído del manifiesto del dataset: cada caso
 * con el veredicto que el motor debe dar (la prueba del dataset lo exige) y cuántos terminan
 * en cada salida. Nada inventado: si el manifiesto no se puede leer, la portada no lo muestra.
 */

export type SampleDecision = {
  readonly id: string;
  readonly payee: string;
  readonly reference: string;
  /** Monto con su moneda; null si la moneda no tiene ruta de pago (no hay cómo formatearla). */
  readonly amount: string | null;
  readonly verdict: Verdict;
  /** Por qué, en una frase; en las pagadas, que cumple. */
  readonly reason: string;
};

export type SampleBatch = {
  readonly decisions: readonly SampleDecision[];
  readonly counts: Readonly<Record<Verdict, number>>;
};

export async function loadSampleBatch(): Promise<SampleBatch | null> {
  const cases = await loadExpectedCases().catch(() => null);
  if (!cases || cases.length === 0) return null;
  const counts: Record<Verdict, number> = { pagar: 0, frenar: 0, escalar: 0 };
  const decisions = cases.map((c): SampleDecision => {
    const { document: doc, expected } = c;
    counts[expected.verdict] += 1;
    return {
      id: c.id,
      payee: doc.payee_name,
      reference: doc.invoice_number,
      amount: isSupportedCurrency(doc.currency)
        ? formatMoney(money(doc.total, doc.currency))
        : null,
      verdict: expected.verdict,
      reason: expected.verdict === "pagar" ? "Dentro de tus reglas" : expected.reason,
    };
  });
  return { decisions, counts };
}
