import { z } from "zod";

import { CURRENCY_SPECS, CurrencySchema, type Currency } from "./currency";

/**
 * Dinero: entero en unidad mínima (centavos) con moneda obligatoria.
 *
 * - Nunca hay un número con decimales en el camino del dinero.
 * - Sumar, restar o comparar monedas distintas lanza MoneyError. Convertir es
 *   responsabilidad de `fx.ts`, que es la única función que cruza monedas.
 * - Redondeo: "medio hacia arriba" sobre el valor absoluto (2.5 → 3, -2.5 → -3),
 *   aplicado una sola vez al final de cada operación que lo necesite.
 * - La aritmética intermedia se hace en BigInt y se vuelve a `number` solo si cabe
 *   en el rango entero seguro; si no, lanza.
 */

/** `.int()` ya exige rango entero seguro en zod 4; el esquema no repite el límite. */
export const MoneySchema = z.strictObject({
  amount: z.number().int(),
  currency: CurrencySchema,
});
export type Money = Readonly<z.infer<typeof MoneySchema>>;

/** Monto estrictamente positivo: límites, umbrales, tarifas y totales. */
export const PositiveMoneySchema = MoneySchema.extend({ amount: z.number().int().positive() });

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Construye un monto. Lanza si `amount` no es un entero seguro. */
export function money(amount: number, currency: Currency): Money {
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError(`El monto debe ser un entero seguro, se recibió ${String(amount)}`);
  }
  return Object.freeze({ amount, currency });
}

/** Cero en la moneda dada. */
export function zero(currency: Currency): Money {
  return money(0, currency);
}

function assertSameCurrency(a: Money, b: Money, operation: string): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`No se puede ${operation} ${a.currency} con ${b.currency}`);
  }
}

/** Suma en la misma moneda. Lanza si las monedas difieren o el resultado desborda. */
export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b, "sumar");
  return money(toSafeNumber(BigInt(a.amount) + BigInt(b.amount)), a.currency);
}

/** Resta en la misma moneda. Lanza si las monedas difieren o el resultado desborda. */
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b, "restar");
  return money(toSafeNumber(BigInt(a.amount) - BigInt(b.amount)), a.currency);
}

/** Suma una lista; la lista vacía da cero en `currency`. */
export function sum(items: readonly Money[], currency: Currency): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), zero(currency));
}

/** -1, 0 o 1. Lanza si las monedas difieren. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b, "comparar");
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export function isGreaterThan(a: Money, b: Money): boolean {
  return compare(a, b) === 1;
}

export function isGreaterOrEqual(a: Money, b: Money): boolean {
  return compare(a, b) >= 0;
}

export function isLessThan(a: Money, b: Money): boolean {
  return compare(a, b) === -1;
}

/**
 * Igualdad estructural. A diferencia de `compare`, con monedas distintas devuelve `false`
 * en vez de lanzar: dos montos en monedas distintas nunca son el mismo dinero.
 */
export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

/** Redondeo medio hacia arriba sobre el valor absoluto, con BigInt para no perder precisión. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError("División por cero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Vuelve a `number` solo si el valor cabe en el rango entero seguro; si no, lanza. */
export function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError("El resultado supera el rango seguro de dinero");
  }
  return Number(value);
}

/**
 * Multiplica por una fracción entera (numerador / denominador) y redondea una vez.
 * Sirve para porcentajes (tolerancias) y tarifas: `multiplyRatio(m, 15, 100)` es el 15 %.
 */
export function multiplyRatio(a: Money, numerator: number, denominator: number): Money {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new MoneyError("La fracción debe estar formada por enteros");
  }
  const result = roundDiv(BigInt(a.amount) * BigInt(numerator), BigInt(denominator));
  return money(toSafeNumber(result), a.currency);
}

/** Porcentaje con hasta dos decimales expresado en centésimas: 1250 = 12,50 %. */
export function percentOf(a: Money, basisPoints: number): Money {
  return multiplyRatio(a, basisPoints, 10_000);
}

/**
 * Diferencia relativa de `actual` frente a `expected`, en puntos básicos y en valor absoluto.
 * Con `expected` en cero devuelve 0 si `actual` también es cero, e infinito si no.
 */
export function deviationBasisPoints(actual: Money, expected: Money): number {
  assertSameCurrency(actual, expected, "comparar");
  if (expected.amount === 0) {
    return actual.amount === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  const diff = BigInt(actual.amount) - BigInt(expected.amount);
  const absDiff = diff < 0n ? -diff : diff;
  const absExpected = BigInt(Math.abs(expected.amount));
  return toSafeNumber(roundDiv(absDiff * 10_000n, absExpected));
}

// ---------------------------------------------------------------------------
// Formato y parseo. Nunca símbolos: siempre el código ISO al final.
// ---------------------------------------------------------------------------

function groupDigits(digits: string, separator: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += separator;
  }
  return out;
}

/**
 * `4.800.000 COP`, `1,250.00 USD`, `-37,50 EUR`.
 * COP se muestra sin decimales: el entero se redondea a pesos con medio hacia arriba.
 */
export function formatMoney(m: Money): string {
  const spec = CURRENCY_SPECS[m.currency];
  const dropDigits = spec.minorDigits - spec.displayDigits;
  const scaled =
    dropDigits > 0 ? roundDiv(BigInt(m.amount), 10n ** BigInt(dropDigits)) : BigInt(m.amount);
  const negative = scaled < 0n;
  const abs = (negative ? -scaled : scaled).toString().padStart(spec.displayDigits + 1, "0");
  const intPart = spec.displayDigits > 0 ? abs.slice(0, -spec.displayDigits) : abs;
  const fracPart = spec.displayDigits > 0 ? abs.slice(-spec.displayDigits) : "";
  const body = groupDigits(intPart, spec.groupSeparator);
  const withFraction = fracPart ? `${body}${spec.decimalSeparator}${fracPart}` : body;
  return `${negative ? "-" : ""}${withFraction} ${m.currency}`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inverso exacto de `formatMoney`. Acepta la parte entera con grupos de exactamente tres
 * dígitos o sin separadores, y la parte decimal solo con los decimales que la moneda
 * muestra (`1,250.00 USD`, `1250 USD`; COP sin decimales). Cualquier otra forma lanza.
 */
export function parseMoney(text: string): Money {
  const match = /^\s*(-)?([0-9.,]+)\s+([A-Z]{3})\s*$/.exec(text);
  if (!match) throw new MoneyError(`Formato de dinero inválido: "${text}"`);
  const [, sign, body, code] = match;
  const parsedCurrency = CurrencySchema.safeParse(code);
  if (!parsedCurrency.success || body === undefined) {
    throw new MoneyError(`Moneda no soportada: "${String(code)}"`);
  }
  const currency = parsedCurrency.data;
  const spec = CURRENCY_SPECS[currency];
  const group = escapeRegex(spec.groupSeparator);
  const decimal = escapeRegex(spec.decimalSeparator);
  const fraction =
    spec.displayDigits > 0 ? `(?:${decimal}([0-9]{${String(spec.displayDigits)}}))?` : "";
  const shape = new RegExp(`^(0|[1-9][0-9]{0,2}(?:${group}[0-9]{3})+|[1-9][0-9]*)${fraction}$`);
  const parts = shape.exec(body);
  if (!parts) throw new MoneyError(`Formato de dinero inválido: "${text}"`);
  const intText = (parts[1] ?? "").split(spec.groupSeparator).join("");
  const fracText = (parts[2] ?? "").padEnd(spec.minorDigits, "0");
  const minor = BigInt(intText + fracText);
  const amount = toSafeNumber(sign === "-" ? -minor : minor);
  return money(amount, currency);
}
