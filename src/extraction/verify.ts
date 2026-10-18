import {
  EXTRACTED_FIELD_NAMES,
  isPresent,
  normalizeText,
  stripDiacritics,
  type Ambiguity,
  type ExtractedFieldName,
  type Extraction,
  type Suspicion,
} from "@/src/domain";
import { TOTALS_TOLERANCE, type VerificationReport } from "@/src/engine";

import { MAX_WORDS_CHARS, spanishWordsToNumber } from "./words";

/**
 * Verificador: código que comprueba lo que el modelo dijo contra el documento.
 * - Cada cita literal existe en el texto (comparando con espacios colapsados).
 * - El valor normalizado se deriva de la literal: montos, fechas, textos, moneda.
 * - Subtotal más impuestos cuadra con el total.
 * - Monto en letras distinto del numérico, o un segundo "total" en el documento, son ambigüedad.
 * - Una moneda citada solo con "$" vale si el documento la nombra en otra parte ("USD",
 *   "dólares", "pesos colombianos"); si no, es ambigüedad: "$" es dólar, peso colombiano,
 *   mexicano o argentino, y otro modelo no lo puede saber mejor.
 *
 * Sin texto (documento escaneado) solo se puede comprobar la coherencia interna. La página
 * de la cita no se comprueba aquí: el texto llega unido; queda para cuando se verifique
 * contra el texto de cada página.
 */

export type VerificationIssue =
  | { readonly kind: "evidence_missing"; readonly field: ExtractedFieldName }
  | {
      readonly kind: "value_not_derived";
      readonly field: ExtractedFieldName;
      readonly detail: string;
    };

export type Verification = {
  readonly report: VerificationReport;
  readonly issues: readonly VerificationIssue[];
};

/** Texto comparable: espacios colapsados, sin acentos, minúsculas. */
function comparable(text: string): string {
  return stripDiacritics(text).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Solo letras y dígitos, en mayúsculas: cuentas, identificadores y números de factura. */
function alphanumeric(text: string): string {
  return stripDiacritics(text)
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();
}

/**
 * Candidatos numéricos de una literal: grupos de miles de exactamente tres dígitos
 * (separados por punto, coma, apóstrofo o espacio) y una fracción opcional de uno a tres.
 */
const NUMBER_PATTERN = /\d{1,3}(?:[.,'\s]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?/g;

/** Convierte un candidato ya aislado a unidad mínima (dos decimales), o null si es ambiguo. */
function parseNumber(raw: string): number | null {
  const digits = raw.replace(/[\s']/g, "");
  const lastSep = Math.max(digits.lastIndexOf(","), digits.lastIndexOf("."));
  let integer = digits;
  let fraction = "";
  if (lastSep >= 0) {
    const sep = digits.charAt(lastSep);
    const tail = digits.slice(lastSep + 1);
    const both = digits.includes(",") && digits.includes(".");
    const repeated = digits.split(sep).length > 2;
    const decimal = both || (!repeated && tail.length <= 2);
    if (!decimal && tail.length !== 3) return null;
    if (decimal) {
      // Tres decimales solo si el último es cero ("4.800.000,000"); si no, no se adivina.
      if (tail.length === 3 && !tail.endsWith("0")) return null;
      fraction = tail.slice(0, 2);
      integer = digits.slice(0, lastSep);
    }
  }
  const whole = integer.replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  const value = Number(`${whole}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Número en unidad mínima a partir de una literal con separadores de miles y decimales.
 * Toma el candidato con más dígitos ("IVA 19 %: 766.386,55" da 766.386,55, no 19); en
 * empate, el último. Paréntesis o un signo menos delante lo hacen negativo. La notación
 * científica ("1e5") no es un monto de factura y devuelve null.
 */
export function amountFromLiteral(literal: string): number | null {
  if (/\d[eE][+-]?\d/.test(literal)) return null;
  let best: { raw: string; index: number } | null = null;
  for (const match of literal.matchAll(NUMBER_PATTERN)) {
    const raw = match[0].trim();
    const size = raw.replace(/\D/g, "").length;
    if (best === null || size >= best.raw.replace(/\D/g, "").length) {
      best = { raw, index: match.index };
    }
  }
  if (best === null) return null;
  const value = parseNumber(best.raw);
  if (value === null) return null;
  const before = literal.slice(0, best.index).trimEnd();
  const after = literal.slice(best.index + best.raw.length).trimStart();
  const negative = before.endsWith("-") || (before.endsWith("(") && after.startsWith(")"));
  return negative ? -value : value;
}

const MONTHS: Readonly<Record<string, number>> = {
  enero: 1,
  ene: 1,
  january: 1,
  jan: 1,
  janeiro: 1,
  januar: 1,
  febrero: 2,
  feb: 2,
  february: 2,
  fevereiro: 2,
  februar: 2,
  marzo: 3,
  mar: 3,
  march: 3,
  marco: 3,
  marz: 3,
  abril: 4,
  abr: 4,
  april: 4,
  apr: 4,
  mayo: 5,
  may: 5,
  maio: 5,
  mai: 5,
  junio: 6,
  jun: 6,
  june: 6,
  junho: 6,
  juni: 6,
  julio: 7,
  jul: 7,
  july: 7,
  julho: 7,
  juli: 7,
  agosto: 8,
  ago: 8,
  august: 8,
  aug: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  september: 9,
  setembro: 9,
  octubre: 10,
  oct: 10,
  october: 10,
  outubro: 10,
  oktober: 10,
  okt: 10,
  noviembre: 11,
  nov: 11,
  november: 11,
  novembro: 11,
  diciembre: 12,
  dic: 12,
  december: 12,
  dec: 12,
  dezembro: 12,
  dezember: 12,
  dez: 12,
};

function isoFrom(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * Fechas que un documento puede mostrar, a ISO. Numéricas (año al inicio o al final, con
 * año de dos dígitos) y con el mes en letras en español, inglés, portugués y alemán. Con día
 * y mes ambiguos devuelve ambas lecturas válidas.
 */
export function datesFromLiteral(literal: string): string[] {
  const out = new Set<string>();
  const add = (iso: string | null) => {
    if (iso !== null) out.add(iso);
  };
  const text = stripDiacritics(literal).toLowerCase();
  for (const m of text.matchAll(/(?<!\d)(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?!\d)/g)) {
    add(isoFrom(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g)) {
    const [, a, b, y] = m;
    if (a && b && y) {
      add(isoFrom(fullYear(y), Number(b), Number(a)));
      add(isoFrom(fullYear(y), Number(a), Number(b)));
    }
  }
  for (const m of text.matchAll(
    /(?<!\d)(\d{1,2})\.?\s+(?:de\s+)?([a-z]{3,10})\.?,?\s+(?:de\s+)?(\d{4})(?!\d)/g,
  )) {
    const month = MONTHS[m[2] ?? ""];
    if (month !== undefined) add(isoFrom(Number(m[3]), month, Number(m[1])));
  }
  for (const m of text.matchAll(/(?<![a-z])([a-z]{3,10})\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)/g)) {
    const month = MONTHS[m[1] ?? ""];
    if (month !== undefined) add(isoFrom(Number(m[3]), month, Number(m[2])));
  }
  return [...out];
}

function evidenceInText(literal: string, text: string): boolean {
  return comparable(text).includes(comparable(literal));
}

/** Símbolos que nombran una sola moneda. */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  us$: "USD",
  u$s: "USD",
  col$: "COP",
  r$: "BRL",
  mx$: "MXN",
  "€": "EUR",
};

/** Cómo un documento nombra cada moneda, además de su código. */
const CURRENCY_NAMES: Readonly<Record<string, RegExp>> = {
  USD: /(?<!\p{L})(?:us\$|u\$s|d[oó]lar(?:es)?(?:\s+(?:americanos|estadounidenses))?|dollars?)(?!\p{L})/iu,
  EUR: /€|(?<!\p{L})euros?(?!\p{L})/iu,
  COP: /col\$|(?<!\p{L})pesos?\s+colombianos?(?!\p{L})/iu,
  BRL: /r\$|(?<!\p{L})reais(?!\p{L})/iu,
  MXN: /mx\$|(?<!\p{L})pesos?\s+mexicanos?(?!\p{L})/iu,
  ARS: /(?<!\p{L})pesos?\s+argentinos?(?!\p{L})/iu,
};

/** La literal de la moneda la nombra: el código o un símbolo que solo es de ella. */
function currencyInLiteral(code: string, literal: string): boolean {
  const l = comparable(literal);
  if (l.includes(code.toLowerCase())) return true;
  return Object.entries(CURRENCY_SYMBOLS).some(([symbol, c]) => c === code && l.includes(symbol));
}

/** El documento nombra la moneda en alguna parte: su código como palabra o su nombre. */
export function currencyNamedInText(code: string, text: string): boolean {
  if (new RegExp(`(?<![A-Za-z])${code}(?![A-Za-z])`).test(text)) return true;
  return CURRENCY_NAMES[code]?.test(text) ?? false;
}

/** Monedas que se escriben con un "$" a secas. */
const DOLLAR_SIGN_CURRENCIES: readonly string[] = ["USD", "COP", "MXN", "ARS"];

/** Campos que se comparan solo por letras y dígitos: el formato impreso lleva espacios. */
const IDENTIFIER_FIELDS: ReadonlySet<ExtractedFieldName> = new Set([
  "bank_account",
  "payee_tax_id",
  "invoice_number",
]);

function valueDerived(name: ExtractedFieldName, value: unknown, literal: string): string | null {
  switch (name) {
    case "subtotal":
    case "taxes":
    case "total": {
      const parsed = amountFromLiteral(literal);
      return parsed === value ? null : `la literal "${literal}" no da ${String(value)}`;
    }
    case "hours": {
      const parsed = amountFromLiteral(literal);
      return parsed !== null && Math.round(parsed / 100) === value
        ? null
        : `la literal "${literal}" no da ${String(value)} horas`;
    }
    case "issue_date":
    case "due_date":
      return typeof value === "string" && datesFromLiteral(literal).includes(value)
        ? null
        : `la literal "${literal}" no da la fecha ${String(value)}`;
    case "currency":
      return typeof value === "string" && currencyInLiteral(value, literal)
        ? null
        : `la literal "${literal}" no contiene ${String(value)}`;
    case "description":
      // Es un resumen del concepto, a veces traducido: basta con que la cita exista. No
      // decide a quién ni cuánto se paga, y no amerita una segunda pasada.
      return typeof value === "string" ? null : "valor no textual";
    default: {
      if (typeof value !== "string") return "valor no textual";
      const v = IDENTIFIER_FIELDS.has(name) ? alphanumeric(value) : normalizeText(value);
      const l = IDENTIFIER_FIELDS.has(name) ? alphanumeric(literal) : normalizeText(literal);
      return v.length > 0 && (l.includes(v) || v.includes(l))
        ? null
        : `la literal "${literal}" no contiene "${value}"`;
    }
  }
}

/** Lo que sigue a "total" y no es el total a pagar: horas, impuestos, descuentos, conteos. */
const NOT_A_TOTAL =
  /^\s*(?:de\s+)?(?:horas|hours|h\b|stunden|iva|impuestos?|tax(?:es)?|vat|mwst|descuentos?|discounts?|registros|records|items|[ií]tems|art[ií]culos|unidades|units|cantidad|qty|p[aá]ginas|pages)/i;

/** Montos que aparecen tras la palabra "total" en el documento, en unidad mínima. */
export function totalsInText(text: string): number[] {
  const out: number[] = [];
  // "total" como palabra: "Subtotal" no cuenta.
  const pattern = /(?<![a-z])total\b([^\d\n]{0,40}?)(-?\d[\d.,\s]*\d)/gi;
  for (const match of text.matchAll(pattern)) {
    if (NOT_A_TOTAL.test(match[1] ?? "")) continue;
    const raw = match[2] ?? "";
    // Un monto tiene decimales o al menos tres dígitos; "Total registros: 3" no lo es.
    if (!/[.,]\d{2}(?!\d)/.test(raw) && raw.replace(/\D/g, "").length < 3) continue;
    const amount = amountFromLiteral(raw);
    if (amount !== null) out.push(amount);
  }
  return out;
}

export function verifyExtraction(extraction: Extraction, text: string | null): Verification {
  const issues: VerificationIssue[] = [];
  const ambiguities: Ambiguity[] = [];
  const suspicions: Suspicion[] = [];
  let totals: VerificationReport["totals"] = "not_applicable";

  if (extraction.kind !== "invoice") {
    return { report: { evidence_missing: [], totals, ambiguities, suspicions }, issues };
  }
  const { fields } = extraction;

  for (const name of EXTRACTED_FIELD_NAMES) {
    const field = fields[name];
    if (!isPresent(field)) continue;
    // Un valor que escribió una persona no es una cita del documento: la evidencia es quién
    // lo corrigió, y eso queda en la decisión. El motor exige otra persona para pagarlo.
    if (field.source === "humano") continue;
    if (text !== null && text.length > 0 && !evidenceInText(field.evidence.literal, text)) {
      issues.push({ kind: "evidence_missing", field: name });
      continue;
    }
    const problem = valueDerived(name, field.value, field.evidence.literal);
    if (problem === null) continue;
    if (name === "currency" && field.evidence.literal.includes("$")) {
      // "$" a secas: vale si el documento nombra la moneda en otra parte. Si no, decide una
      // persona; no es un error de lectura y no amerita una segunda pasada.
      if (text !== null && currencyNamedInText(String(field.value), text)) continue;
      const others = DOLLAR_SIGN_CURRENCIES.filter((c) => c !== field.value);
      ambiguities.push({ field: "currency", candidates: [String(field.value), ...others] });
      continue;
    }
    issues.push({ kind: "value_not_derived", field: name, detail: problem });
  }

  if (isPresent(fields.subtotal) && isPresent(fields.taxes)) {
    const diff = Math.abs(fields.subtotal.value + fields.taxes.value - fields.total.value);
    totals = diff <= TOTALS_TOLERANCE ? "ok" : "mismatch";
  }

  // Si una persona fijó el total, eligió entre los candidatos del documento: no es ambiguo.
  if (text !== null && fields.total.source !== "humano") {
    const seen = totalsInText(text).filter((t) => t !== fields.total.value);
    if (seen.length > 0) {
      ambiguities.push({
        field: "total",
        candidates: [String(fields.total.value), ...seen.slice(0, 3).map(String)],
      });
    }
    const words = wordsAmount(text);
    if (words !== null && Math.abs(words * 100 - fields.total.value) > TOTALS_TOLERANCE * 100) {
      ambiguities.push({
        field: "total",
        candidates: [String(fields.total.value), `${String(words)} en letras`],
      });
    }
  }

  // El Juez recibe un solo "sin evidencia válida" por campo; el detalle queda en `issues`.
  const withoutEvidence = issues.map((i) => i.field);
  return {
    report: { evidence_missing: [...new Set(withoutEvidence)], totals, ambiguities, suspicions },
    issues,
  };
}

/**
 * Monto en letras del documento, tras un rótulo reconocible seguido de dos puntos. Recorre
 * todas las apariciones y devuelve la primera que se puede leer: "Las facturas son
 * pagaderas" no tapa el "Son: cien mil pesos" que viene después.
 */
export function wordsAmount(text: string): number | null {
  const pattern = new RegExp(
    String.raw`(?<!\p{L})(?:son|importe con letra|amount in words|in worten|valor en letras|monto en letras)\s*:\s*([^\n]{1,${String(MAX_WORDS_CHARS)}})`,
    "giu",
  );
  for (const match of text.matchAll(pattern)) {
    const value = spanishWordsToNumber(match[1] ?? "");
    if (value !== null) return value;
  }
  return null;
}

/**
 * Verdadero si la verificación encontró algo que otra lectura podría corregir: una cita que
 * no está o un valor que no se deriva de ella, o totales que no cuadran. Las ambigüedades
 * vienen del documento (dos totales, monto en letras distinto) y ningún modelo las resuelve,
 * así que no justifican pagar una segunda pasada.
 */
export function needsFallback(verification: Verification): boolean {
  return verification.issues.length > 0 || verification.report.totals === "mismatch";
}
