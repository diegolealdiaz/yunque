import { and, eq, sql } from "drizzle-orm";

import { LedgerPeriodSchema, type Currency, type LedgerPeriod, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { DbError } from "../errors";
import { ledgerPeriods } from "../schema";

/**
 * Libro mayor de presupuesto por periodo. La reserva es un `UPDATE` condicional: solo
 * escribe si `committed + amount <= limit`. N reservas concurrentes contra un límite L
 * comprometen como máximo L; las que no caben reciben `budget_exceeded`.
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
    .onConflictDoNothing();
}

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
    ? LedgerPeriodSchema.parse({
        organization_id: row.organizationId,
        period_key: row.periodKey,
        currency: row.currency,
        limit: row.limit,
        committed: row.committed,
        updated_at: row.updatedAt,
      })
    : null;
}

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
