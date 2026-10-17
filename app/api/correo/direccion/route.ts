import { z } from "zod";

import { newInboundToken } from "@/src/session";
import { requestInboundAddress } from "@/src/usecases";

import { appContext } from "../../../_data/context";
import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../../_data/http";

/**
 * Dirección de correo personal de la demo (D23): se entrega solo a quien escribe el código
 * de acceso. La empresa sale de la cookie del visitante, nunca del cuerpo de la petición.
 */

const RequestSchema = z.strictObject({ codigo: z.string().min(1).max(200) });

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  try {
    const { config, db, organization } = await appContext();
    const inbound = config.inboundEmail;
    if (inbound === null || !config.demo.enabled) {
      return Response.json(
        {
          error: {
            code: "not_found",
            message: "El correo de entrada está apagado",
            action: "Sube la factura desde Facturas",
          },
        },
        { status: 404 },
      );
    }
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    const view = await requestInboundAddress(db, {
      organizationId: organization.id,
      code: parsed.success ? parsed.data.codigo : "",
      expectedCode: inbound.accessCode,
      base: inbound.address,
      ttlHours: inbound.addressTtlHours,
      now: new Date(),
      newToken: newInboundToken,
    });
    return Response.json(view);
  } catch (error) {
    return errorResponse(error);
  }
}
