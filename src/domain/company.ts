import { z } from "zod";

import { CurrencySchema } from "./currency";
import { FxTableSchema } from "./fx";
import { UlidSchema } from "./ids";
import type { Period } from "./policy";

/**
 * Organización (empresa). En la demo cada visitante recibe una copia de la empresa
 * ficticia; en producto, cada cliente es una organización.
 */

export const OrganizationSchema = z.strictObject({
  id: UlidSchema,
  name: z.string().min(1).max(200),
  /** Prefijo de las referencias legibles: `YQ-2026-10-0001`. */
  reference_prefix: z.string().regex(/^[A-Z]{2,4}$/),
  base_currency: z.literal("USD"),
  fx: FxTableSchema,
  /** Id del visitante de la demo dueño de esta copia. Null fuera de la demo. */
  demo_visitor_id: z.string().min(1).max(100).nullable(),
  created_at: z.iso.datetime(),
});
export type Organization = Readonly<z.infer<typeof OrganizationSchema>>;

/** Saldo simulado por moneda. Baja con cada "pagar" y con cada aprobación humana. */
export const BalanceSchema = z.strictObject({
  organization_id: UlidSchema,
  currency: CurrencySchema,
  /** Unidad mínima. Puede llegar a cero, nunca a negativo. */
  available: z.number().int().min(0),
  updated_at: z.iso.datetime(),
});
export type Balance = Readonly<z.infer<typeof BalanceSchema>>;

/** `2026-10` para mes, `2026-W42` para semana ISO (01 a 53). */
export const PeriodKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2]|W(0[1-9]|[1-4]\d|5[0-3]))$/, {
    error: "Clave de periodo inválida",
  });

/** Compromisos de presupuesto por periodo. La reserva es un UPDATE condicional atómico. */
export const LedgerPeriodSchema = z
  .strictObject({
    organization_id: UlidSchema,
    period_key: PeriodKeySchema,
    currency: CurrencySchema,
    limit: z.number().int().min(0),
    committed: z.number().int().min(0),
    updated_at: z.iso.datetime(),
  })
  .refine((l) => l.committed <= l.limit, {
    path: ["committed"],
    error: "Lo comprometido no puede superar el límite del periodo",
  });
export type LedgerPeriod = Readonly<z.infer<typeof LedgerPeriodSchema>>;

/** Clave de periodo en UTC. Semana ISO para `week`. Lanza con una fecha inválida. */
export function periodKey(date: Date, period: Period): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("Fecha inválida para periodKey");
  const year = date.getUTCFullYear();
  if (period === "month") {
    return `${String(year)}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const { isoYear, isoWeek } = isoWeekOf(date);
  return `${String(isoYear)}-W${String(isoWeek).padStart(2, "0")}`;
}

/** Semana ISO 8601: la semana 1 es la que contiene el primer jueves del año. */
function isoWeekOf(date: Date): { isoYear: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const isoWeek = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { isoYear, isoWeek };
}
