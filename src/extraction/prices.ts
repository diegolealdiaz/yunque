/**
 * Precios por millón de tokens en micro-USD (1 USD = 1.000.000). Sirven para calcular el
 * costo de cada llamada y mostrarlo por factura. Se actualizan a mano; un modelo sin precio
 * registra costo cero y se avisa en la pantalla de salud.
 */

export type ModelPrice = { readonly inputPerMillion: number; readonly outputPerMillion: number };

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "anthropic/claude-haiku-5.5": { inputPerMillion: 1_000_000, outputPerMillion: 5_000_000 },
  "anthropic/claude-sonnet-5.5": { inputPerMillion: 3_000_000, outputPerMillion: 15_000_000 },
};

/** Costo en micro-USD de una llamada; cero si el modelo no tiene precio o faltan tokens. */
export function costUsdMicros(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return Math.round((input * price.inputPerMillion + output * price.outputPerMillion) / 1_000_000);
}
