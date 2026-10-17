import { stripDiacritics } from "@/src/domain";

/**
 * Convierte un monto escrito en letras (español) a número de unidades enteras.
 * Sirve para comparar "cuatro millones ochocientos mil pesos" con el monto numérico.
 * Devuelve null si no se reconoce: no se adivina.
 */

const UNITS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};

const SCALES: Record<string, number> = { mil: 1_000, millon: 1_000_000, millones: 1_000_000 };

/** Palabras que acompañan al monto y no aportan valor: moneda, rótulos, "exactos". */
const NOISE = new Set([
  "cte",
  "mcte",
  "l",
  "ml",
  "colombianos",
  "mexicanos",
  "argentinos",
  "americanos",
  "estadounidenses",
  "us",
  "cop",
  "mxn",
  "usd",
  "ars",
  "brl",
  "eur",
  "solamente",
  "netos",
  "pesos",
  "peso",
  "dolares",
  "dolar",
  "euros",
  "euro",
  "reales",
  "real",
  "m",
  "n",
  "mn",
  "de",
  "y",
  "con",
  "exactos",
  "moneda",
  "nacional",
  "corriente",
  "legal",
  "cts",
  "centavos",
  "centimos",
]);

function strip(text: string): string {
  return stripDiacritics(text).toLowerCase();
}

/**
 * Parsea la parte entera de un monto en letras. Ignora la fracción ("00/100") y la moneda.
 * "cuatro millones ochocientos mil pesos" → 4800000. "ciento setenta y ocho mil" → 178000.
 */
/** Entrada máxima: un monto en letras nunca supera esto; acota el costo del parseo. */
export const MAX_WORDS_CHARS = 300;

export function spanishWordsToNumber(text: string): number | null {
  // Fracción "00/100" acotada a tres dígitos por lado: sin backtracking sobre dígitos largos.
  // "con cincuenta centavos" es la fracción: se corta ahí, nunca se suma al entero.
  const integerPart =
    strip(text.slice(0, MAX_WORDS_CHARS)).split(/\bcon\b|\bcentavos\b|\bcts\b/)[0] ?? "";
  const cleaned = integerPart.replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g, " ");
  const tokens = cleaned.split(/[^a-z]+/).filter((t) => t.length > 0 && !NOISE.has(t));
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  let recognized = false;
  for (const token of tokens) {
    const unit = UNITS[token];
    if (unit !== undefined) {
      current += unit;
      recognized = true;
      continue;
    }
    const scale = SCALES[token];
    if (scale !== undefined) {
      recognized = true;
      if (scale === 1_000) {
        current = (current === 0 ? 1 : current) * 1_000;
        total += current;
        current = 0;
      } else {
        // "un millón" → 1; "mil millones" → 1000 ya acumulado, no se suma otro 1.
        const units = current === 0 && total === 0 ? 1 : current;
        total = (total + units) * scale;
        current = 0;
      }
      continue;
    }
    return null;
  }
  return recognized ? total + current : null;
}
