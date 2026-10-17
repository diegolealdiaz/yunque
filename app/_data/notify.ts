import { after } from "next/server";

import { getConfig } from "@/src/config";
import { getDatabase } from "@/src/db/client";
import { createUlidGenerator, type Ulid } from "@/src/domain";
import { deliverDueNotifications, type NotificationSender } from "@/src/usecases";

/**
 * Canales de aviso de la app y la entrega después de responder.
 *
 * - Pantalla: la decisión ya está en Pendientes y en el detalle; entregar es dejar constancia.
 * - Telegram: el canal de entrada de Telegram es el primer recorte del plan, así que en esta
 *   versión el aviso se entrega a un canal simulado y la bitácora lo marca como simulado (D21).
 */

const newId = createUlidGenerator();

const screen: NotificationSender = () => Promise.resolve({ simulated: false });
const simulatedTelegram: NotificationSender = () => Promise.resolve({ simulated: true });

/**
 * Entrega los avisos pendientes de la empresa cuando la respuesta ya salió: quien decidió no
 * espera al canal. Si algo falla aquí, los avisos siguen en la cola y se reintentan en la
 * próxima entrega; no hay a quién mostrarle el error.
 */
export function deliverNotificationsAfterResponse(organizationId: Ulid): void {
  after(async () => {
    try {
      const config = getConfig();
      await deliverDueNotifications(
        {
          db: await getDatabase(config.database),
          newId,
          now: () => new Date(),
          senders: { pantalla: screen, telegram: simulatedTelegram },
        },
        { organizationId },
      );
    } catch {
      // La cola conserva el estado: el próximo intento retoma lo que quedó pendiente.
    }
  });
}
