import { z } from "zod";

import { getConfig } from "@/src/config";
import { createUlidGenerator } from "@/src/domain";
import { newInboundToken } from "@/src/session";
import { ensureInboundAddress, grantDemoAccess, requireAccess } from "@/src/usecases";

import { appContext } from "../../_data/context";
import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../_data/http";

/**
 * Acceso de jurado (D23, D24): con el código correcto, la empresa del visitante obtiene
 * acceso al correo real y a Telegram por un tiempo, y su dirección de correo si el correo
 * está encendido. Sin código, renueva la dirección mientras el acceso siga vigente. Los
 * intentos fallidos se limitan por empresa (429 al pasarse). La
 * empresa sale de la cookie del visitante, nunca del cuerpo de la petición.
 */

const newId = createUlidGenerator();

const RequestSchema = z.strictObject({ codigo: z.string().min(1).max(200).optional() });

const notFound = () =>
  Response.json(
    {
      error: {
        code: "not_found",
        message: "El acceso de jurado está apagado",
        action: "Sube la factura desde Facturas",
      },
    },
    { status: 404 },
  );

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  try {
    // Primero el interruptor: con todo apagado no se siembra ninguna empresa.
    const settings = getConfig();
    const access = settings.demo.enabled ? settings.access : null;
    if (access === null) return notFound();
    const { config, db, organization } = await appContext();
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    const now = new Date();
    const code = parsed.success ? parsed.data.codigo : undefined;
    const grant =
      code === undefined
        ? await requireAccess(db, organization.id, now)
        : await grantDemoAccess(db, {
            organizationId: organization.id,
            code,
            expectedCode: access.code,
            ttlHours: access.ttlHours,
            now,
            newId,
          });
    const email = config.inboundEmail
      ? await ensureInboundAddress(db, {
          organizationId: organization.id,
          base: config.inboundEmail.address,
          until: grant.expiresAt,
          now,
          newToken: newInboundToken,
        })
      : null;
    return Response.json({ expiresAt: grant.expiresAt, email });
  } catch (error) {
    return errorResponse(error);
  }
}
