import { and, eq, sql } from "drizzle-orm";

import { LedgerPeriodSchema, type Currency, type LedgerPeriod, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { DbError } from "../errors";
import { parseRow } from "../rows";
import { ledgerPeriods } from "../schema";

/**
 * Libro mayor de presupuesto por periodo. La reserva es un `UPDATE` condicional: solo
 * escribe si `committed + amount <= limit`. N reservas concurrentes contra un límite L
 * comprometen como máximo L; las que no caben reciben `budget_exceeded`.
 */

/**
 * Crea el periodo si no existe y, si existe, actualiza su límite al de la política vigente.
 * Así un cambio de presupuesto a mitad de mes aplica de inmediato sin perder lo comprometido.
 */
export async function ensureLedgerPeriod(
  exec: Executor,
  organizationId: Ulid,
  periodKey: string,
  currency: Currency,
  limit: number,
  now: string,
): Promise<void> {
  await exec
    .insert(ledgerPeriods)
    .values({ organizationId, periodKey, currency, limit, committed: 0, updatedAt: now })
    .onConflictDoUpdate({
      target: [ledgerPeriods.organizationId, ledgerPeriods.periodKey, ledgerPeriods.currency],
      set: { limit, updatedAt: now },
      setWhere: sql`${ledgerPeriods.limit} <> ${limit}`,
    });
}

/** Periodo de presupuesto, o null si todavía no se creó. */
export async function getLedgerPeriod(
  exec: Executor,
  organizationId: Ulid,
  periodKey: string,
  currency: Currency,
): Promise<LedgerPeriod | null> {
  const row = await exec.query.ledgerPeriods.findFirst({
    where: and(
      eq(ledgerPeriods.organizationId, organizationId),
      eq(ledgerPeriods.periodKey, periodKey),
      eq(ledgerPeriods.currency, currency),
    ),
  });
  return row
    ? parseRow(
        LedgerPeriodSchema,
        {
          organization_id: row.organizationId,
          period_key: row.periodKey,
          currency: row.currency,
          limit: row.limit,
          committed: row.committed,
          updated_at: row.updatedAt,
        },
        "ledger_periods",
      )
    : null;
}

/**
 * Reserva `amount` en el periodo con `UPDATE ... WHERE committed + amount <= limit`.
 * Sin filas afectadas: `budget_exceeded` si el periodo existe, `not_found` si no.
 */
export async function reserveBudget(
  exec: Executor,
  organizationId: Ulid,
  periodKey: string,
  currency: Currency,
  amount: number,
  now: string,
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError("La reserva debe ser un entero positivo");
  }
  const result = await exec
    .update(ledgerPeriods)
    .set({ committed: sql`${ledgerPeriods.committed} + ${amount}`, updatedAt: now })
    .where(
      and(
        eq(ledgerPeriods.organizationId, organizationId),
        eq(ledgerPeriods.periodKey, periodKey),
        eq(ledgerPeriods.currency, currency),
        sql`${ledgerPeriods.committed} + ${amount} <= ${ledgerPeriods.limit}`,
      ),
    );
  if (result.rowsAffected === 0) {
    const period = await getLedgerPeriod(exec, organizationId, periodKey, currency);
    if (!period) throw new DbError("not_found", `No existe el periodo ${periodKey} en ${currency}`);
    throw new DbError("budget_exceeded", `El presupuesto de ${periodKey} no alcanza`);
  }
}

/** Libera una reserva (por ejemplo, un escalado rechazado que había comprometido). */
export async function releaseBudget(
  exec: Executor,
  organizationId: Ulid,
  periodKey: string,
  currency: Currency,
  amount: number,
  now: string,
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError("La liberación debe ser un entero positivo");
  }
  const result = await exec
    .update(ledgerPeriods)
    .set({ committed: sql`${ledgerPeriods.committed} - ${amount}`, updatedAt: now })
    .where(
      and(
        eq(ledgerPeriods.organizationId, organizationId),
        eq(ledgerPeriods.periodKey, periodKey),
        eq(ledgerPeriods.currency, currency),
        sql`${ledgerPeriods.committed} >= ${amount}`,
      ),
    );
  if (result.rowsAffected === 0) {
    throw new DbError("stale_state", `No hay ${String(amount)} comprometidos en ${periodKey}`);
  }
}
