import { createHash } from "node:crypto";

import { z } from "zod";

import type { Currency } from "./currency";

/**
 * Hashes y llaves de identidad de una factura.
 *
 * - `documentHash`: SHA-256 sobre los bytes del archivo. Es la identidad del documento
 *   para idempotencia y caché. Dos archivos distintos con el mismo texto son dos documentos.
 * - `jsonHash`: SHA-256 del JSON canónico (claves ordenadas). Firma políticas, extracciones
 *   y payloads de aprobación, así que solo admite valores JSON puros.
 * - `semanticKey`: identidad del cobro (beneficiario + número + monto + moneda) normalizada
 *   para que "F-2291" y "f 2291" sean la misma factura aunque vengan en otro formato.
 */

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, { error: "SHA-256 inválido" });
export type Sha256 = z.infer<typeof Sha256Schema>;

export class HashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HashError";
  }
}

/** SHA-256 en hexadecimal de bytes o de un texto en UTF-8. */
export function sha256Hex(data: Uint8Array | string): Sha256 {
  return createHash("sha256").update(data).digest("hex");
}

/** Identidad del archivo: hash sobre sus bytes, nunca sobre el texto extraído. */
export function documentHash(bytes: Uint8Array): Sha256 {
  return sha256Hex(bytes);
}

/** Hash estable de un valor JSON: claves ordenadas en todos los niveles. */
export function jsonHash(value: unknown): Sha256 {
  return sha256Hex(canonicalJson(value));
}

/**
 * Serialización canónica: claves ordenadas, sin `undefined`. Solo acepta valores JSON
 * puros (null, boolean, número finito, string, arreglos y objetos planos). Cualquier otro
 * valor, como `Date`, `Map` o `bigint`, lanza para que nunca se firme un objeto vacío.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value, "$"));
}

function sortKeys(value: unknown, path: string): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new HashError(`${path}: número no finito`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) =>
      item === undefined ? null : sortKeys(item, `${path}[${String(i)}]`),
    );
  }
  if (typeof value === "object") {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new HashError(`${path}: solo se admiten objetos planos`);
    }
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v, `${path}.${k}`)]));
  }
  throw new HashError(`${path}: tipo no serializable (${typeof value})`);
}

/** Marcas diacríticas combinantes (U+0300 a U+036F) que deja la descomposición NFD. */
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  "g",
);

/** Quita las marcas diacríticas: "Peña" → "Pena". No cambia mayúsculas ni puntuación. */
export function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "");
}

/**
 * Normaliza texto para comparar: sin acentos, en mayúsculas, sin puntuación, un solo espacio.
 * Conserva letras y dígitos de cualquier alfabeto (latino, cirílico, griego, CJK). La
 * puntuación se elimina sin dejar espacio ("S.A.S." → "SAS"); los espacios se colapsan.
 * "Nube Andina S.A.S." → "NUBE ANDINA SAS".
 */
export function normalizeText(text: string): string {
  return stripDiacritics(text)
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Normaliza un número de factura: solo letras y dígitos, en mayúsculas. "F-2291" → "F2291". */
export function normalizeInvoiceNumber(text: string): string {
  return normalizeText(text).replace(/\s+/g, "");
}

export type SemanticKeyInput = {
  readonly payeeName: string;
  readonly invoiceNumber: string;
  readonly amount: number;
  readonly currency: Currency;
};

/**
 * Llave de identidad del cobro. Lanza si el beneficiario o el número quedan vacíos tras
 * normalizar: una llave con partes vacías haría chocar facturas de distintos proveedores.
 */
export function semanticKey(input: SemanticKeyInput): string {
  const payee = normalizeText(input.payeeName);
  const number = normalizeInvoiceNumber(input.invoiceNumber);
  if (payee === "") throw new HashError("El beneficiario queda vacío al normalizar");
  if (number === "") throw new HashError("El número de factura queda vacío al normalizar");
  if (!Number.isSafeInteger(input.amount)) throw new HashError("El monto debe ser entero");
  return [payee, number, String(input.amount), input.currency].join("|");
}
