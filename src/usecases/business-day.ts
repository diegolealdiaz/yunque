/**
 * Día de negocio. Los vencimientos son fechas de calendario en la zona de la empresa, no
 * instantes: una factura que vence "hoy" en Bogotá a las 22:00 ya es "mañana" en UTC.
 * El motor cuenta días en UTC, así que recibe la medianoche UTC del día de negocio.
 */

import { DATASET_TODAY } from "@/src/dataset/schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de calendario (`YYYY-MM-DD`) de un instante en la zona horaria dada. */
export function businessDateOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: "year" | "month" | "day") => parts.find((p) => p.type === type)?.value;
  const date = `${part("year") ?? ""}-${part("month") ?? ""}-${part("day") ?? ""}`;
  if (!ISO_DATE.test(date)) throw new RangeError(`No se pudo calcular el día en ${timeZone}`);
  return date;
}

/** Medianoche UTC de una fecha de calendario: el `now` que espera el motor. */
export function engineNow(businessDate: string): Date {
  const date = new Date(`${businessDate}T00:00:00.000Z`);
  // La vuelta a texto descarta fechas que no existen, como el 30 de febrero.
  if (
    !ISO_DATE.test(businessDate) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== businessDate
  ) {
    throw new RangeError(`Día de negocio inválido: ${businessDate}`);
  }
  return date;
}

/** Diferencia entre la hora local de la zona y UTC en ese instante, en milisegundos. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante en que empezó hoy en la zona de la empresa: lo que la bandeja llama "hoy". */
export function startOfBusinessDay(now: Date, timeZone: string): Date {
  const midnightAsUtc = engineNow(businessDateOf(now, timeZone));
  return new Date(midnightAsUtc.getTime() - zoneOffsetMs(midnightAsUtc, timeZone));
}

/**
 * Día de negocio vigente. En la demo es fijo, el del dataset, para que vencimientos y
 * ventanas den siempre lo mismo; en producto, el del reloj en la zona de la empresa.
 */
export function currentBusinessDate(
  options: { readonly demo: boolean; readonly timeZone: string },
  now: Date,
): string {
  return options.demo ? DATASET_TODAY : businessDateOf(now, options.timeZone);
}

/**
 * Día de negocio de un instante ya pasado: a qué periodo pertenece una decisión. En la demo el
 * día de hoy es fijo; lo decidido antes conserva su fecha (el historial sembrado) y lo
 * decidido después cae en el día del dataset, que es el día en que el agente lo decidió.
 */
export function businessDateAt(
  options: { readonly demo: boolean; readonly timeZone: string },
  instant: Date,
): string {
  const date = businessDateOf(instant, options.timeZone);
  return options.demo && date > DATASET_TODAY ? DATASET_TODAY : date;
}
