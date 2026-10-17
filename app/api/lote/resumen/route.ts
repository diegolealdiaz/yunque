import { sendSampleSummary } from "@/src/usecases";

import { appContext } from "../../../_data/context";
import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../../_data/http";
import { businessDayStart } from "../../../_data/limits";
import { telegramClient } from "../../../_data/telegram";

/**
 * Resumen de las facturas de ejemplo (D24): la pantalla lo pide al terminar el lote o la
 * bandeja simulada, y llega en un solo mensaje a los chats de Telegram conectados de la
 * empresa del visitante, en vez de un aviso por factura. Sin bot o sin chats, no manda nada.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  try {
    const { config, db, organization } = await appContext();
    if (!config.demo.enabled || config.telegram === null) return Response.json({ sent: false });
    const { sent } = await sendSampleSummary(
      { db, client: telegramClient(config.telegram), publicAppUrl: config.publicAppUrl },
      { organizationId: organization.id, since: businessDayStart(config) },
    );
    return Response.json({ sent });
  } catch (error) {
    return errorResponse(error);
  }
}
