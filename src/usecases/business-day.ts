/**
 * Día de negocio. Los vencimientos son fechas de calendario en la zona de la empresa, no
 * instantes: una factura que vence "hoy" en Bogotá a las 22:00 ya es "mañana" en UTC.
 * El motor cuenta días en UTC, así que recibe la medianoche UTC del día de negocio.
 */

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
