import { withWriteTransaction, type Database } from "@/src/db/client";
import {
  appendEvent,
  claimNotification,
  listDueNotifications,
  settleNotification,
} from "@/src/db/repositories";
import {
  UlidSchema,
  type Notification,
  type NotificationChannel,
  type Ulid,
  type UlidGenerator,
} from "@/src/domain";

/**
 * Entrega de avisos (docs/arquitectura.md "Notificador"). La tabla de notificaciones es la
 * cola: la decisión encola sus avisos en su misma transacción, y aquí se entregan.
 *
 * - Cada aviso se reclama con comparación y cambio antes de entregarlo: dos entregas a la
 *   vez no mandan el mismo aviso dos veces.
 * - Si el canal falla, se reintenta con espera creciente (1, 2, 4, 8 minutos). Al quinto
 *   intento fallido queda `fallida`, con su evento en la bitácora, y la salud lo muestra.
 * - Un reclamo cuyo proceso murió a mitad de camino vuelve a estar disponible cuando vence
 *   su plazo, con el intento ya contado.
 */

export const MAX_NOTIFICATION_ATTEMPTS = 5;
/** Espera antes del segundo intento; se duplica en cada intento siguiente. */
export const NOTIFICATION_BACKOFF_MS = 60_000;
/** Cuánto dura un reclamo antes de que otro proceso pueda retomar el aviso. */
export const NOTIFICATION_LEASE_MS = 2 * 60_000;

/** Lo que dice el canal al entregar. `simulated`: el canal es de la demo, no uno real. */
export type DeliveryReceipt = { readonly simulated: boolean };

/** Entrega un aviso por su canal. Lanza si no pudo: el aviso se reintenta. */
export type NotificationSender = (notification: Notification) => Promise<DeliveryReceipt>;

export type DeliveryDeps = {
  readonly db: Database;
  readonly newId: UlidGenerator;
  readonly now: () => Date;
  readonly senders: Readonly<Record<NotificationChannel, NotificationSender>>;
};

export type DeliveryResult = {
  readonly sent: number;
  /** Fallaron y quedaron para otro intento. */
  readonly retrying: number;
  /** Fallaron por última vez. */
  readonly failed: number;
  /** Otro proceso los reclamó antes. */
  readonly skipped: number;
};

/** Espera antes del intento siguiente a `attempts` intentos: 1, 2, 4, 8 minutos. */
export function retryDelayMs(attempts: number): number {
  return NOTIFICATION_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
}

/** Error en una línea para guardar: sin pila ni datos de la petición. */
function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

export async function deliverDueNotifications(
  deps: DeliveryDeps,
  input: { readonly organizationId: Ulid; readonly limit?: number },
): Promise<DeliveryResult> {
  const result = { sent: 0, retrying: 0, failed: 0, skipped: 0 };
  const due = await listDueNotifications(
    deps.db,
    input.organizationId,
    deps.now().toISOString(),
    input.limit ?? 50,
  );
  for (const notification of due) {
    const claimedAt = deps.now();
    const attempts = notification.attempts + 1;
    const claimed = await claimNotification(
      deps.db,
      input.organizationId,
      notification.id,
      notification.attempts,
      new Date(claimedAt.getTime() + NOTIFICATION_LEASE_MS).toISOString(),
      claimedAt.toISOString(),
    );
    if (!claimed) {
      result.skipped += 1;
      continue;
    }

    let receipt: DeliveryReceipt | null = null;
    let failure: string | null = null;
    try {
      receipt = await deps.senders[notification.channel](notification);
    } catch (error) {
      failure = describeFailure(error);
    }

    const at = deps.now();
    const nowIso = at.toISOString();
    const last = failure !== null && attempts >= MAX_NOTIFICATION_ATTEMPTS;
    await withWriteTransaction(deps.db, async (tx) => {
      await settleNotification(tx, input.organizationId, notification.id, attempts, {
        status: failure === null ? "enviada" : last ? "fallida" : "pendiente",
        nextAttemptAt:
          failure === null || last
            ? null
            : new Date(at.getTime() + retryDelayMs(attempts)).toISOString(),
        lastError: failure,
        nowIso,
      });
      // Los reintentos no van a la bitácora: solo el resultado final de cada aviso.
      if (failure === null || last) {
        const invoiceId = UlidSchema.safeParse(notification.payload["invoice_id"]);
        const decisionId = UlidSchema.safeParse(notification.payload["decision_id"]);
        await appendEvent(tx, {
          id: deps.newId(),
          organization_id: input.organizationId,
          type: failure === null ? "notification.sent" : "notification.failed",
          actor: { kind: "agente" },
          invoice_id: invoiceId.success ? invoiceId.data : null,
          decision_id: decisionId.success ? decisionId.data : null,
          data: {
            channel: notification.channel,
            attempts,
            ...(receipt ? { simulated: receipt.simulated } : {}),
            ...(failure === null ? {} : { error: failure }),
          },
          trace_id: `tr-${notification.id}`,
          occurred_at: nowIso,
        });
      }
    });
    if (failure === null) result.sent += 1;
    else if (last) result.failed += 1;
    else result.retrying += 1;
  }
  return result;
}
