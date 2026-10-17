import { z } from "zod";

import { CURRENCY_SPECS, CurrencySchema, type Currency } from "./currency";
import { money, roundDiv, toSafeNumber, type Money } from "./money";

/**
 * Tasas de cambio fijas del set. Única puerta para cruzar monedas.
 *
 * Cada tasa es "unidades de la moneda por 1 USD", guardada como entero con seis
 * decimales (escala 1e6): 4.150,25 COP por USD se guarda como 4_150_250_000.
 * La conversión hace una sola multiplicación entera y un solo redondeo medio hacia
 * arriba, así el resultado no depende del orden en que se sumen los montos.
 */

export const RATE_SCALE = 1_000_000n;

export const FxTableSchema = z
  .strictObject({
    base: z.literal("USD"),
    /** Escala 1e6. La tabla es completa: todas las monedas soportadas tienen tasa. */
    perUsd: z.record(CurrencySchema, z.number().int().positive()),
    /** Fecha de referencia de las tasas, informativa. */
    asOf: z.iso.date(),
  })
  .refine((t) => t.perUsd.USD === Number(RATE_SCALE), {
    path: ["perUsd", "USD"],
    error: "La tasa de USD debe ser exactamente 1.000.000 (1 USD por USD)",
  });
export type FxTable = Readonly<z.infer<typeof FxTableSchema>>;

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxError";
  }
}

function minorFactor(currency: Currency): bigint {
  return 10n ** BigInt(CURRENCY_SPECS[currency].minorDigits);
}

/** Convierte a USD con un solo redondeo. Identidad si ya está en USD. */
export function toUsd(m: Money, table: FxTable): Money {
  if (m.currency === "USD") return m;
  const rate = BigInt(table.perUsd[m.currency]);
  const numerator = BigInt(m.amount) * minorFactor("USD") * RATE_SCALE;
  const denominator = minorFactor(m.currency) * rate;
  return money(toSafeNumber(roundDiv(numerator, denominator)), "USD");
}

/** Convierte desde USD a otra moneda con un solo redondeo. */
export function fromUsd(usd: Money, target: Currency, table: FxTable): Money {
  if (usd.currency !== "USD") throw new FxError("fromUsd espera un monto en USD");
  if (target === "USD") return usd;
  const rate = BigInt(table.perUsd[target]);
  const numerator = BigInt(usd.amount) * minorFactor(target) * rate;
  const denominator = minorFactor("USD") * RATE_SCALE;
  return money(toSafeNumber(roundDiv(numerator, denominator)), target);
}

/** Convierte entre dos monedas cualesquiera pasando por USD, con dos redondeos como máximo. */
export function convert(m: Money, target: Currency, table: FxTable): Money {
  if (m.currency === target) return m;
  return fromUsd(toUsd(m, table), target, table);
}
