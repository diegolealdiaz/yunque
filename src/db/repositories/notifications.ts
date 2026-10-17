import { and, asc, eq } from "drizzle-orm";

import { NotificationSchema, type Notification, type Ulid } from "@/src/domain";

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
  return rows.map((row) =>
    parseRow(
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
    ),
  );
}
