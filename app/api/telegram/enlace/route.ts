import { newTelegramLinkToken } from "@/src/session";
import { createTelegramLink, requireAccess } from "@/src/usecases";

import { appContext } from "../../../_data/context";
import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../../_data/http";

/**
 * Enlace para conectar un chat de Telegram a la empresa del visitante (D24). Solo con el
 * acceso de jurado vigente; el enlace es de un solo uso y vence en una hora.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  try {
    const { config, db, organization } = await appContext();
    if (!config.demo.enabled || config.telegram === null) {
      return Response.json(
        {
          error: {
            code: "not_found",
            message: "Telegram está apagado",
            action: "Usa la pantalla de Yunque",
          },
        },
        { status: 404 },
      );
    }
    const now = new Date();
    const grant = await requireAccess(db, organization.id, now);
    const link = await createTelegramLink(db, {
      organizationId: organization.id,
      grant,
      botUsername: config.telegram.botUsername,
      now,
      newToken: newTelegramLinkToken,
    });
    return Response.json(link);
  } catch (error) {
    return errorResponse(error);
  }
}
