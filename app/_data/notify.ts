import { after } from "next/server";

import { getConfig } from "@/src/config";
import { getDatabase } from "@/src/db/client";
import { createUlidGenerator, type Ulid } from "@/src/domain";
import { deliverDueNotifications, telegramSender, type NotificationSender } from "@/src/usecases";

import { telegramClient } from "./telegram";

/**
 * Canales de aviso de la app y la entrega después de responder.
 *
 * - Pantalla: la decisión ya está en Pendientes y en el detalle; entregar es dejar constancia.
 * - Telegram: con el bot configurado, el aviso llega a los chats conectados de la empresa
 *   (D24). Sin bot, o sin chats conectados, se entrega a un canal simulado y la bitácora lo
 *   marca como simulado (D21).
 */

const newId = createUlidGenerator();

const screen: NotificationSender = () => Promise.resolve({ simulated: false });
const simulatedTelegram: NotificationSender = () => Promise.resolve({ simulated: true });

/**
 * Entrega los avisos pendientes de la empresa ahora. Si algo falla, los avisos siguen en la
 * cola y se reintentan en la próxima entrega; no hay a quién mostrarle el error, solo queda
 * en el log. Nunca lanza.
 */
export async function deliverNotifications(organizationId: Ulid): Promise<void> {
  try {
    const config = getConfig();
    const db = await getDatabase(config.database);
    const telegram =
      config.telegram === null
        ? simulatedTelegram
        : telegramSender({
            db,
            client: telegramClient(config.telegram),
            publicAppUrl: config.publicAppUrl,
          });
    await deliverDueNotifications(
      {
        db,
        newId,
        now: () => new Date(),
        senders: { pantalla: screen, telegram },
      },
      { organizationId },
    );
  } catch (error) {
    // La cola conserva el estado: el próximo intento retoma lo que quedó pendiente. Se
    // registra para que una falla que se repite se vea en los logs del despliegue.
    console.error("No se pudieron entregar los avisos", { organizationId, error });
  }
}

/**
 * Entrega los avisos pendientes de la empresa cuando la respuesta ya salió: quien decidió no
 * espera al canal. Dentro de un trabajo que ya corre después de responder, usa
 * `deliverNotifications` directamente.
 */
export function deliverNotificationsAfterResponse(organizationId: Ulid): void {
  after(() => deliverNotifications(organizationId));
}
