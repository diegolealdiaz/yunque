import { and, count, desc, eq, lt, min } from "drizzle-orm";

import { LlmCallStatusSchema, type LlmCall, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { invoices, llmCalls, notifications } from "../schema";

/**
 * Lo que la salud necesita de una empresa, en pocas consultas de agregado: escaladas
 * esperando, la más vieja, cuántas vencieron, avisos fallidos y la última llamada al modelo.
 */

export type HealthSnapshot = {
  readonly waiting: number;
  /** Desde cuándo espera la escalada más vieja (su última actualización); null si no hay. */
  readonly oldestWaitingSince: string | null;
  /** Escaladas cuya espera de aprobación ya venció. */
  readonly expired: number;
  readonly failedNotifications: number;
  readonly lastModelCall: Pick<LlmCall, "status" | "error" | "created_at"> | null;
};

export async function readHealthSnapshot(
  exec: Executor,
  organizationId: Ulid,
  now: Date,
): Promise<HealthSnapshot> {
  const waitingWhere = and(
    eq(invoices.organizationId, organizationId),
    eq(invoices.status, "esperando_aprobacion"),
  );
  const [waiting, expired, failed, lastCall] = await Promise.all([
    exec
      .select({ total: count(), oldest: min(invoices.updatedAt) })
      .from(invoices)
      .where(waitingWhere),
    exec
      .select({ total: count() })
      .from(invoices)
      .where(and(waitingWhere, lt(invoices.approvalExpiresAt, now.toISOString()))),
    exec
      .select({ total: count() })
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, organizationId), eq(notifications.status, "fallida")),
      ),
    exec
      .select({ status: llmCalls.status, error: llmCalls.error, createdAt: llmCalls.createdAt })
      .from(llmCalls)
      .where(eq(llmCalls.organizationId, organizationId))
      .orderBy(desc(llmCalls.createdAt), desc(llmCalls.id))
      .limit(1),
  ]);
  const call = lastCall[0];
  return {
    waiting: waiting[0]?.total ?? 0,
    oldestWaitingSince: waiting[0]?.oldest ?? null,
    expired: expired[0]?.total ?? 0,
    failedNotifications: failed[0]?.total ?? 0,
    lastModelCall: call
      ? {
          status: LlmCallStatusSchema.parse(call.status),
          error: call.error,
          created_at: call.createdAt,
        }
      : null,
  };
}
