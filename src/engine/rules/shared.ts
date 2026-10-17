import {
  isPresent,
  isSupportedCurrency,
  money,
  toUsd,
  type Currency,
  type Evidence,
  type ExtractedFields,
  type Money,
} from "@/src/domain";

import type { EvaluationContext } from "../context";

/** Ayudas compartidas por las reglas: monto leído, conversión a USD, evidencia por campo. */

/** Campos leídos si la extracción es una factura; null si no lo es. */
export function fieldsOf(ctx: EvaluationContext): ExtractedFields | null {
  return ctx.extraction.kind === "invoice" ? ctx.extraction.fields : null;
}

/** Moneda leída si está soportada. */
export function currencyOf(ctx: EvaluationContext): Currency | null {
  const fields = fieldsOf(ctx);
  if (!fields) return null;
  return isSupportedCurrency(fields.currency.value) ? fields.currency.value : null;
}

/** Total leído en su moneda, solo si la moneda está soportada. */
export function amountOf(ctx: EvaluationContext): Money | null {
  const fields = fieldsOf(ctx);
  const currency = currencyOf(ctx);
  if (!fields || !currency) return null;
  return money(fields.total.value, currency);
}

/** Total leído convertido a USD con la tasa fija de la empresa. */
export function amountUsdOf(ctx: EvaluationContext): Money | null {
  const amount = amountOf(ctx);
  return amount ? toUsd(amount, ctx.fx) : null;
}

/** Evidencia de un campo leído, o null si el campo falta. */
export function evidenceOf(ctx: EvaluationContext, field: keyof ExtractedFields): Evidence | null {
  const fields = fieldsOf(ctx);
  if (!fields) return null;
  const f = fields[field];
  return isPresent(f) ? f.evidence : null;
}

/** Días enteros entre dos fechas en UTC (b - a). */
export function daysBetween(a: Date, b: Date): number {
  const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((dayB - dayA) / 86_400_000);
}

/** `YYYY-MM-DD` en UTC. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Fecha ISO `YYYY-MM-DD` a instante UTC a medianoche. Lanza si la fecha no existe. */
export function parseIsoDate(text: string): Date {
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== text) {
    throw new RangeError(`Fecha inválida: ${text}`);
  }
  return date;
}

/** Instante de un ISO 8601 en milisegundos, para comparar sin depender del formato del texto. */
export function instantOf(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Instante inválido: ${iso}`);
  return ms;
}

/** Suma días (puede ser negativo) a un instante. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Solo dígitos y letras, en mayúsculas: para comparar cuentas con formato distinto. */
export function accountDigits(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}
