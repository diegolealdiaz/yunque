import { and, asc, eq, lte } from "drizzle-orm";

import { NotificationSchema, UlidSchema, type Notification, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { parseRow } from "../rows";
import { notifications } from "../schema";

/**
 * Notificaciones: cola outbox. Encolar es idempotente por `idempotency_key`; la entrega
 * con reintentos y espera creciente vive en el Notificador.
 */

/** Encola un aviso. Si ya existe uno con la misma llave, no hace nada. */
export async function enqueueNotification(
  exec: Executor,
  notification: Notification,
): Promise<void> {
  const n = NotificationSchema.parse(notification);
  await exec
    .insert(notifications)
    .values({
      id: n.id,
      organizationId: n.organization_id,
      channel: n.channel,
      idempotencyKey: n.idempotency_key,
      payload: n.payload,
      status: n.status,
      attempts: n.attempts,
      nextAttemptAt: n.next_attempt_at,
      lastError: n.last_error,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    })
    .onConflictDoNothing({ target: [notifications.organizationId, notifications.idempotencyKey] });
}

function toNotification(row: typeof notifications.$inferSelect): Notification {
  return parseRow(
    NotificationSchema,
    {
      id: row.id,
      organization_id: row.organizationId,
      channel: row.channel,
      idempotency_key: row.idempotencyKey,
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      next_attempt_at: row.nextAttemptAt,
      last_error: row.lastError,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    },
    "notifications",
  );
}

/** Avisos de la organización, los más viejos primero, con filtro opcional por estado. */
export async function listNotifications(
  exec: Executor,
  organizationId: Ulid,
  filter: { status?: Notification["status"]; limit?: number } = {},
): Promise<Notification[]> {
  const rows = await exec.query.notifications.findMany({
    where: and(
      eq(notifications.organizationId, organizationId),
      filter.status === undefined ? undefined : eq(notifications.status, filter.status),
    ),
    orderBy: [asc(notifications.createdAt), asc(notifications.id)],
    limit: filter.limit ?? 200,
  });
  return rows.map(toNotification);
}

/** Avisos pendientes cuyo próximo intento ya llegó, los más viejos primero. */
export async function listDueNotifications(
  exec: Executor,
  organizationId: Ulid,
  nowIso: string,
  limit = 50,
): Promise<Notification[]> {
  const rows = await exec.query.notifications.findMany({
    where: and(
      eq(notifications.organizationId, organizationId),
      eq(notifications.status, "pendiente"),
      lte(notifications.nextAttemptAt, nowIso),
    ),
    orderBy: [asc(notifications.nextAttemptAt), asc(notifications.id)],
    limit,
  });
  return rows.map(toNotification);
}

/**
 * Empresas con algún aviso pendiente cuyo próximo intento ya llegó: el cron entrega los de
 * cada una. Sin filtro de organización, y solo devuelve ids.
 */
export async function listOrganizationsWithDueNotifications(
  exec: Executor,
  nowIso: string,
  limit = 100,
): Promise<Ulid[]> {
  const rows = await exec
    .selectDistinct({ organizationId: notifications.organizationId })
    .from(notifications)
    .where(and(eq(notifications.status, "pendiente"), lte(notifications.nextAttemptAt, nowIso)))
    .limit(limit);
  return rows.map((row) => UlidSchema.parse(row.organizationId));
}

/**
 * Reclama un aviso para entregarlo: suma el intento y corre el próximo intento hasta
 * `leaseUntil`, solo si sigue pendiente con los intentos que se leyeron (comparación y
 * cambio). Si otro proceso lo reclamó antes, devuelve false y no se entrega dos veces.
 */
export async function claimNotification(
  exec: Executor,
  organizationId: Ulid,
  id: Ulid,
  expectedAttempts: number,
  leaseUntil: string,
  nowIso: string,
): Promise<boolean> {
  const result = await exec
    .update(notifications)
    .set({ attempts: expectedAttempts + 1, nextAttemptAt: leaseUntil, updatedAt: nowIso })
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.id, id),
        eq(notifications.status, "pendiente"),
        eq(notifications.attempts, expectedAttempts),
      ),
    );
  return result.rowsAffected === 1;
}

/**
 * Cierra un intento ya reclamado: enviada, fallida, o pendiente con su próximo intento.
 * Devuelve false si el reclamo ya no es de quien cierra (venció y otro lo retomó).
 */
export async function settleNotification(
  exec: Executor,
  organizationId: Ulid,
  id: Ulid,
  claimedAttempts: number,
  outcome: {
    readonly status: Notification["status"];
    readonly nextAttemptAt: string | null;
    readonly lastError: string | null;
    readonly nowIso: string;
  },
): Promise<boolean> {
  const result = await exec
    .update(notifications)
    .set({
      status: outcome.status,
      nextAttemptAt: outcome.nextAttemptAt,
      lastError: outcome.lastError,
      updatedAt: outcome.nowIso,
    })
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.id, id),
        eq(notifications.status, "pendiente"),
        eq(notifications.attempts, claimedAttempts),
      ),
    );
  return result.rowsAffected === 1;
}
