/**
 * Formatos de pantalla (docs/interfaz.md §6 y §7). Funciones puras: la interfaz nunca
 * calcula montos ni veredictos, solo los presenta.
 *
 * - Fechas en UTC en base; en pantalla, en la zona de la empresa.
 * - Relativas en listas ("vence en 2 días"), absolutas en detalle y bitácora.
 * - Montos con el código ISO al final; los formatea el dominio (`formatMoney`).
 */

export const DISPLAY_TIME_ZONE = "America/Bogota";

const DAY_MS = 86_400_000;

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  return Math.round(
    (Date.parse(`${toIsoDate}T00:00:00Z`) - Date.parse(`${fromIsoDate}T00:00:00Z`)) / DAY_MS,
  );
}

/** Vencimiento relativo al día de negocio: "vence hoy", "vence en 2 días", "vencida hace 3 días". */
export function dueRelative(dueDate: string | null, today: string): string {
  if (dueDate === null) return "sin vencimiento";
  const days = daysBetween(today, dueDate);
  if (days === 0) return "vence hoy";
  if (days === 1) return "vence mañana";
  if (days > 1) return `vence en ${String(days)} días`;
  if (days === -1) return "vencida ayer";
  return `vencida hace ${String(-days)} días`;
}

/**
 * Partes de una fecha formateada en español, sin los puntos de las abreviaturas ("oct.").
 * Se arma por partes para no depender de los "de" ni de las comas de cada navegador.
 */
function dateParts(
  date: Date,
  options: Intl.DateTimeFormatOptions,
): (type: Intl.DateTimeFormatPartTypes) => string {
  const parts = new Intl.DateTimeFormat("es-CO", options).formatToParts(date);
  return (type) => (parts.find((p) => p.type === type)?.value ?? "").replace(/\./g, "");
}

const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

/** Fecha de calendario absoluta: "18 oct 2026". */
export function calendarDate(isoDate: string): string {
  const get = dateParts(new Date(`${isoDate}T00:00:00Z`), {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${get("day")} ${get("month")} ${get("year")}`;
}

/** Instante en la zona de la empresa: "16 oct, 09:12". */
export function instant(iso: string, timeZone: string = DISPLAY_TIME_ZONE): string {
  const get = dateParts(new Date(iso), { timeZone, day: "numeric", month: "short", ...CLOCK });
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

/** Instante absoluto con segundos, para la bitácora: "16 oct 2026, 09:12:05". */
export function auditInstant(iso: string, timeZone: string = DISPLAY_TIME_ZONE): string {
  const get = dateParts(new Date(iso), {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    second: "2-digit",
    ...CLOCK,
  });
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** Solo la hora en la zona de la empresa: "09:12". */
export function clock(iso: string, timeZone: string = DISPLAY_TIME_ZONE): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

const PERCENT = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 1 });

/** Proporción como porcentaje: 0.939 → "93,9 %". */
export function percent(rate: number): string {
  return PERCENT.format(rate).replace(/\s*%/, " %");
}

/** Costo en micro-USD con cuatro decimales: 2100 → "0,0021 USD". */
export function usdMicros(micros: number): string {
  const value = new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(micros / 1_000_000);
  return `${value} USD`;
}

const DECIMAL = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

/**
 * Duración corta para tarjetas y tablas, en la unidad más grande que la deja legible:
 * 850 → "850 ms", 1240 → "1,2 s", 720000 → "12 min", 18000000 → "5 h", 3 días → "3 d".
 */
export function duration(ms: number): string {
  const value = Math.max(0, ms);
  if (value < 1000) return `${String(Math.round(value))} ms`;
  if (value < 60_000) return `${DECIMAL.format(value / 1000)} s`;
  if (value < 3_600_000) return `${String(Math.floor(value / 60_000))} min`;
  if (value < 86_400_000) return `${String(Math.floor(value / 3_600_000))} h`;
  return `${String(Math.floor(value / 86_400_000))} d`;
}

/** Cuánto texto de datos de un evento cabe en una celda de la bitácora. */
const EVENT_DATA_MAX = 240;

function eventValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/**
 * Los datos de un evento tal como quedaron escritos, en una línea: `clave: valor · clave:
 * valor`. Sin interpretar: la bitácora muestra la auditoría sin transformarla. Se corta con
 * "…" si no cabe; el detalle completo está en la factura.
 */
export function eventData(data: Readonly<Record<string, unknown>>): string {
  const text = Object.entries(data)
    .map(([key, value]) => `${key}: ${eventValue(value)}`)
    .join(" · ");
  return text.length <= EVENT_DATA_MAX ? text : `${text.slice(0, EVENT_DATA_MAX - 1)}…`;
}

/** Hash o identificador largo recortado para pantalla: "3f9a1c…". */
export function shortHash(hash: string, length = 6): string {
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}
