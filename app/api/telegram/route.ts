import { after } from "next/server";

import { sameSecret } from "@/src/session";
import { TelegramUpdateSchema } from "@/src/telegram";
import { handleTelegramUpdate } from "@/src/usecases";

import { readBodyCapped } from "../../_data/http";
import { businessDayStart, demoInvoiceLimits } from "../../_data/limits";
import { deliverNotifications } from "../../_data/notify";
import { processingDeps } from "../../_data/process";
import { telegramClient, telegramContext } from "../../_data/telegram";

/**
 * Webhook del bot de Telegram (D24). La ruta solo autentica, valida y delega:
 *
 * 1. Telegram manda el secreto configurado en `X-Telegram-Bot-Api-Secret-Token`; sin él, 401.
 * 2. La respuesta sale enseguida con 200: Telegram no espera la lectura del modelo y no
 *    reintenta. Un cuerpo inválido también recibe 200, porque reintentarlo no lo arregla.
 * 3. `handleTelegramUpdate` atiende el mensaje después de responder: conecta el chat o
 *    procesa la factura. Los avisos de la decisión salen por la cola, con reintentos.
 */

/** La lectura corre después de responder, dentro del plazo de la función. */
export const maxDuration = 90;

/** Una actualización de Telegram es JSON chico: los archivos se descargan aparte. */
const MAX_BODY_BYTES = 100_000;

const status = (value: string, code = 200) => Response.json({ status: value }, { status: code });

export async function POST(request: Request): Promise<Response> {
  const context = await telegramContext();
  if (context === null) return status("not_found", 404);
  const { config, telegram, db } = context;
  const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!sameSecret(secret, telegram.webhookSecret)) return status("unauthorized", 401);

  const raw = await readBodyCapped(request, MAX_BODY_BYTES);
  if (raw === null) return status("too_large");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return status("invalid");
  }
  const parsed = TelegramUpdateSchema.safeParse(json);
  if (!parsed.success) return status("invalid");

  after(async () => {
    const now = new Date();
    try {
      const outcome = await handleTelegramUpdate(
        {
          db,
          client: telegramClient(telegram),
          now,
          since: businessDayStart(config, now),
          maxPerChatPerDay: telegram.maxPerChatPerDay,
          invoiceLimits: demoInvoiceLimits(config),
          process: processingDeps(config, db),
        },
        parsed.data,
      );
      if (outcome.kind === "processed" && outcome.organizationId) {
        await deliverNotifications(outcome.organizationId);
      }
    } catch (error) {
      // Casi siempre, Telegram no aceptó la respuesta al chat. No hay a quién mostrarlo.
      console.error("No se pudo atender una actualización de Telegram", {
        updateId: parsed.data.update_id,
        error,
      });
    }
  });
  return status("accepted");
}
