import { after } from "next/server";

import { createUlidGenerator } from "@/src/domain";
import { verifyWebhookAuth } from "@/src/session";
import { InboundEmailSchema, admitInboundEmail, processInboundEmail } from "@/src/usecases";

import { readBodyCapped } from "../../../_data/http";
import { inboundContext } from "../../../_data/inbound";
import { businessDayStart, demoInvoiceLimits } from "../../../_data/limits";
import { deliverNotifications } from "../../../_data/notify";
import { processingDeps } from "../../../_data/process";

/**
 * Webhook del correo real (D23): el proveedor (Postmark) lo llama con cada correo que llega
 * a una dirección de la demo. La ruta solo autentica, valida el cuerpo y delega:
 *
 * 1. `admitInboundEmail` decide y reserva el cupo antes de responder.
 * 2. La respuesta sale enseguida con 200: el proveedor no espera la lectura del modelo y no
 *    reintenta. Un cuerpo inválido también recibe 200, porque reintentarlo no lo arregla.
 * 3. `processInboundEmail` procesa la factura después de responder.
 *
 * Yunque nunca responde el correo.
 */

/** La lectura corre después de responder, dentro del plazo de la función. */
export const maxDuration = 90;

/**
 * Tope del cuerpo: el proveedor manda los adjuntos en base64 (cuatro bytes por cada tres),
 * y un correo puede traer más de un adjunto. Dos veces el tope de archivo cubre el adjunto
 * válido más grande con holgura; el megabyte extra es para cuerpo, cabeceras y JSON.
 */
const maxBodyBytes = (maxUploadBytes: number) => maxUploadBytes * 2 + 1_000_000;

const newId = createUlidGenerator();

const status = (value: string, code = 200) => Response.json({ status: value }, { status: code });

export async function POST(request: Request): Promise<Response> {
  const context = await inboundContext();
  if (context === null) return status("not_found", 404);
  const { config, inbound, db } = context;
  if (!verifyWebhookAuth(request.headers.get("authorization"), inbound.webhookSecret)) {
    return status("unauthorized", 401);
  }

  const raw = await readBodyCapped(request, maxBodyBytes(config.demo.maxUploadBytes));
  if (raw === null) return status("too_large");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return status("invalid");
  }
  const parsed = InboundEmailSchema.safeParse(json);
  if (!parsed.success) return status("invalid");
  const email = parsed.data;

  const now = new Date();
  const since = businessDayStart(config, now);
  const admission = await admitInboundEmail(db, {
    email,
    limits: { maxPerAddressPerDay: inbound.maxPerAddressPerDay, maxPerDay: inbound.maxPerDay },
    now,
    since,
    newId,
  });
  if (admission.kind !== "accepted") return status(admission.kind);

  const { organizationId, receiptKey } = admission;
  after(async () => {
    const outcome = await processInboundEmail(processingDeps(config, db), {
      email,
      organizationId,
      receiptKey,
      invoiceLimits: demoInvoiceLimits(config),
      since,
      now,
    });
    if (outcome.kind === "processed") {
      await deliverNotifications(organizationId);
    } else if (outcome.reason === "failed") {
      // Queda en la bitácora de la empresa; aquí, el detalle técnico para el log.
      console.error("No se pudo procesar un correo admitido", { receiptKey, error: outcome.error });
    }
  });
  return status("accepted");
}
