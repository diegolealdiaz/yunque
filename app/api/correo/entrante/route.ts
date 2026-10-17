import { after } from "next/server";

import { getConfig } from "@/src/config";
import { getDatabase } from "@/src/db/client";
import { createUlidGenerator } from "@/src/domain";
import { verifyWebhookAuth } from "@/src/session";
import {
  InboundEmailSchema,
  UseCaseError,
  admitInboundEmail,
  assertWithinDailyLimits,
  inboundPayload,
  processInvoice,
  recordRejectedEmail,
  startOfBusinessDay,
} from "@/src/usecases";

import { deliverNotificationsAfterResponse } from "../../../_data/notify";
import { processingDeps } from "../../../_data/process";

/**
 * Webhook del correo real (D23): el proveedor (Postmark) lo llama con cada correo que llega
 * a una dirección de la demo. Responde enseguida y procesa la factura después: el proveedor
 * no espera la lectura del modelo, y una respuesta 200 evita que reintente.
 *
 * Nada se procesa sin pasar, en orden: el interruptor de la configuración, la contraseña del
 * webhook, una dirección vigente y los topes del día. Yunque nunca responde el correo.
 */

/** La lectura corre después de responder, dentro del plazo de la función. */
export const maxDuration = 90;

/** El cuerpo trae los adjuntos en base64: un tercio más que el tope de archivo, y margen. */
const MAX_BODY_FACTOR = 2;

const newId = createUlidGenerator();

const notFound = () =>
  Response.json(
    { error: { code: "not_found", message: "El correo de entrada está apagado", action: "" } },
    { status: 404 },
  );

export async function POST(request: Request): Promise<Response> {
  const config = getConfig();
  const inbound = config.inboundEmail;
  if (inbound === null || !config.demo.enabled) return notFound();
  if (!verifyWebhookAuth(request.headers.get("authorization"), inbound.webhookSecret)) {
    return Response.json(
      { error: { code: "unauthorized", message: "Credenciales inválidas", action: "" } },
      { status: 401 },
    );
  }

  const maxBody = config.demo.maxUploadBytes * MAX_BODY_FACTOR + 1_000_000;
  if (Number(request.headers.get("content-length") ?? 0) > maxBody) {
    return Response.json({ status: "too_large" });
  }
  const raw = await request.text();
  if (raw.length > maxBody) return Response.json({ status: "too_large" });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ status: "invalid" });
  }
  const parsed = InboundEmailSchema.safeParse(json);
  // Un cuerpo que no es un correo del proveedor no se reintenta: 200 y nada más.
  if (!parsed.success) return Response.json({ status: "invalid" });
  const email = parsed.data;

  const db = await getDatabase(config.database);
  const now = new Date();
  const since = startOfBusinessDay(now, config.displayTimeZone).toISOString();
  const admission = await admitInboundEmail(db, {
    email,
    limits: { maxPerAddressPerDay: inbound.maxPerAddressPerDay, maxPerDay: inbound.maxPerDay },
    now,
    since,
    newId,
  });
  if (admission.kind !== "accepted") return Response.json({ status: admission.kind });

  const { organizationId, receiptKey } = admission;
  after(async () => {
    try {
      await assertWithinDailyLimits(
        db,
        organizationId,
        {
          perOrganization: config.demo.maxInvoicesPerVisitorPerDay,
          global: config.demo.maxInvoicesPerDay,
        },
        since,
        receiptKey,
      );
      const { bytes, originalName } = inboundPayload(email, {
        now,
        maxBytes: config.demo.maxUploadBytes,
      });
      await processInvoice(processingDeps(config, db), {
        organizationId,
        channel: "inbox",
        receiptKey,
        bytes,
        originalName,
      });
      deliverNotificationsAfterResponse(organizationId);
    } catch (error) {
      if (error instanceof UseCaseError && error.code === "limit_reached") {
        await recordRejectedEmail(db, {
          organizationId,
          messageId: email.MessageID,
          reason: "invoice_limit",
          now,
          newId,
        }).catch((e: unknown) => {
          console.error(e);
        });
        return;
      }
      // No hay a quién mostrárselo: queda en el log. Una entrega rechazada no deja factura.
      console.error(error);
    }
  });
  return Response.json({ status: "accepted" });
}
