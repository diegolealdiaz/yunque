import { z } from "zod";

/**
 * Monedas y rutas de pago soportadas. La lista sale de los destinos de Blinka.
 * Una factura en otra moneda o por otra ruta produce `unsupported_currency_or_rail`.
 */

export const CURRENCIES = ["USD", "EUR", "COP", "BRL", "MXN", "ARS"] as const;
export const CurrencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof CurrencySchema>;

export const RAILS = [
  "ach",
  "wire",
  "sepa",
  "bre_b",
  "transferencia_co",
  "pix",
  "ted",
  "spei",
  "cbu",
] as const;
export const RailSchema = z.enum(RAILS);
export type Rail = z.infer<typeof RailSchema>;

export const COUNTRIES = ["US", "EU", "CO", "BR", "MX", "AR"] as const;
export const CountrySchema = z.enum(COUNTRIES);
export type Country = z.infer<typeof CountrySchema>;

type CurrencySpec = {
  /** Dígitos de la unidad mínima: 2 significa que el entero está en centavos. */
  readonly minorDigits: number;
  /** Decimales que se muestran en pantalla. COP se muestra sin decimales. */
  readonly displayDigits: number;
  readonly groupSeparator: "." | ",";
  readonly decimalSeparator: "." | ",";
  /** Rutas válidas para pagar en esta moneda. */
  readonly rails: readonly Rail[];
  readonly country: Country;
};

export const CURRENCY_SPECS: Readonly<Record<Currency, CurrencySpec>> = {
  USD: {
    minorDigits: 2,
    displayDigits: 2,
    groupSeparator: ",",
    decimalSeparator: ".",
    rails: ["ach", "wire"],
    country: "US",
  },
  EUR: {
    minorDigits: 2,
    displayDigits: 2,
    groupSeparator: ".",
    decimalSeparator: ",",
    rails: ["sepa"],
    country: "EU",
  },
  COP: {
    minorDigits: 2,
    displayDigits: 0,
    groupSeparator: ".",
    decimalSeparator: ",",
    rails: ["bre_b", "transferencia_co"],
    country: "CO",
  },
  BRL: {
    minorDigits: 2,
    displayDigits: 2,
    groupSeparator: ".",
    decimalSeparator: ",",
    rails: ["pix", "ted"],
    country: "BR",
  },
  MXN: {
    minorDigits: 2,
    displayDigits: 2,
    groupSeparator: ",",
    decimalSeparator: ".",
    rails: ["spei"],
    country: "MX",
  },
  ARS: {
    minorDigits: 2,
    displayDigits: 2,
    groupSeparator: ".",
    decimalSeparator: ",",
    rails: ["cbu"],
    country: "AR",
  },
};

export function isSupportedCurrency(value: string): value is Currency {
  return CurrencySchema.safeParse(value).success;
}

export function isSupportedRail(value: string): value is Rail {
  return RailSchema.safeParse(value).success;
}

/** Verdadero si la ruta sirve para pagar en esa moneda. */
export function railSupportsCurrency(rail: Rail, currency: Currency): boolean {
  return CURRENCY_SPECS[currency].rails.includes(rail);
}
