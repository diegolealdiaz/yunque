import { getConfig } from "@/src/config";
import { newApiKey } from "@/src/session";
import { issueApiKey } from "@/src/usecases";

import { appContext } from "../../../_data/context";
import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../../_data/http";

/**
 * «Conectar tu agente» (D32): genera la llave de la API de decisión de la empresa del
 * visitante y anula la anterior. Exige el acceso de cliente vigente y vence con él. La llave
 * se devuelve esta única vez; la base guarda solo su huella.
 */

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  try {
    // Primero el interruptor: con el acceso apagado no se siembra ninguna empresa.
    const settings = getConfig();
    if (!settings.demo.enabled || settings.access === null) {
      return Response.json(
        {
          error: {
            code: "not_found",
            message: "La API de decisión está apagada",
            action: "Sube la factura desde Facturas",
          },
        },
        { status: 404 },
      );
    }
    const { db, organization } = await appContext();
    const issued = await issueApiKey(db, {
      organizationId: organization.id,
      now: new Date(),
      newKey: newApiKey,
    });
    return Response.json(issued, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
