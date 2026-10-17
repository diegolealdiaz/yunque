import { randomBytes } from "node:crypto";

import { z } from "zod";

/**
 * Identificadores.
 *
 * - ULID: 26 caracteres Crockford base32, ordenable por tiempo. El generador es
 *   monótono: dos ids del mismo milisegundo salen en orden creciente.
 * - Referencia legible: `YQ-2026-10-0007`, única por empresa, año y mes. La parte
 *   numérica la asigna la base; aquí solo se construye y se valida el formato.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

export const UlidSchema = z
  .string()
  .regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, { error: "ULID inválido" });
export type Ulid = z.infer<typeof UlidSchema>;

export type UlidGenerator = () => Ulid;

type UlidSources = {
  readonly now?: () => number;
  readonly random?: (bytes: number) => Uint8Array;
};

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > 2 ** 48 - 1) {
    throw new RangeError(`Tiempo fuera de rango para ULID: ${String(ms)}`);
  }
  let value = ms;
  let out = "";
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ENCODING[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  // 16 caracteres base32 = 80 bits = 10 bytes.
  if (bytes.length < 10) throw new RangeError("La fuente de azar debe entregar 10 bytes");
  let bits = 0n;
  for (let i = 0; i < 10; i++) bits = (bits << 8n) | BigInt(bytes[i] ?? 0);
  let out = "";
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    out = ENCODING[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}

function incrementBase32(text: string): string {
  const chars = text.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ENCODING.indexOf(chars[i] ?? "0");
    if (idx < 31) {
      chars[i] = ENCODING[idx + 1] ?? "0";
      return chars.join("");
    }
    chars[i] = "0";
  }
  throw new RangeError("Se agotó el espacio aleatorio del ULID en este milisegundo");
}

/**
 * Crea un generador monótono. Las fuentes de tiempo y azar son inyectables para pruebas.
 * Si el reloj retrocede, se sigue usando el último tiempo visto para no romper el orden.
 */
export function createUlidGenerator(sources: UlidSources = {}): UlidGenerator {
  const now = sources.now ?? Date.now;
  const random = sources.random ?? ((n) => new Uint8Array(randomBytes(n)));
  let lastTime = -1;
  let lastRandom = "";

  return () => {
    const time = Math.max(now(), lastTime);
    if (time === lastTime) {
      lastRandom = incrementBase32(lastRandom);
    } else {
      lastTime = time;
      lastRandom = encodeRandom(random(10));
    }
    return encodeTime(time) + lastRandom;
  };
}

/** Milisegundos codificados en el ULID. */
export function ulidTime(id: Ulid): number {
  let value = 0;
  for (let i = 0; i < TIME_LENGTH; i++) {
    value = value * 32 + ENCODING.indexOf(id[i] ?? "0");
  }
  return value;
}

// ---------------------------------------------------------------------------

export const ReferenceSchema = z
  .string()
  .regex(/^[A-Z]{2,4}-\d{4}-(0[1-9]|1[0-2])-(?!0+$)\d{4,}$/, { error: "Referencia inválida" });
export type Reference = z.infer<typeof ReferenceSchema>;

/**
 * Construye una referencia legible. `sequence` es el consecutivo del mes para esa empresa,
 * asignado por la base dentro de una transacción.
 */
export function makeReference(
  prefix: string,
  year: number,
  month: number,
  sequence: number,
): Reference {
  if (!/^[A-Z]{2,4}$/.test(prefix)) throw new RangeError(`Prefijo inválido: ${prefix}`);
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError(`Año inválido: ${String(year)}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Mes inválido: ${String(month)}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Consecutivo inválido: ${String(sequence)}`);
  }
  return `${prefix}-${String(year)}-${String(month).padStart(2, "0")}-${String(sequence).padStart(4, "0")}`;
}

/** Descompone una referencia legible. Lanza si el formato no es válido. */
export function parseReference(ref: Reference): {
  prefix: string;
  year: number;
  month: number;
  sequence: number;
} {
  const match = /^([A-Z]{2,4})-(\d{4})-(\d{2})-(\d{4,})$/.exec(ref);
  if (!match || !ReferenceSchema.safeParse(ref).success) {
    throw new RangeError(`Referencia inválida: ${ref}`);
  }
  return {
    prefix: match[1] ?? "",
    year: Number(match[2]),
    month: Number(match[3]),
    sequence: Number(match[4]),
  };
}
