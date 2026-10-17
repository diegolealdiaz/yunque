import { z } from "zod";

import { mailboxReceiptKey } from "@/src/dataset/demo-seed";
import { loadMailbox } from "@/src/dataset/mailbox";

import {
  deliverDatasetFile,
  demoChannelsDisabled,
  unknownCase,
} from "../../_data/dataset-delivery";
import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../_data/http";

/**
 * "Revisar correo de ejemplo": procesa un correo de la bandeja simulada por petición, como el lote. El
 * navegador nombra el mensaje de una lista cerrada; el archivo lo elige el servidor. La
 * llave sale del Message-ID: un correo se recibe una sola vez aunque se lea dos veces.
 */

/** Como la subida: más que el plazo global de lectura del modelo. */
export const maxDuration = 90;

const RequestSchema = z.strictObject({ mensaje: z.string().regex(/^[a-z0-9_]{1,60}$/) });

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const disabled = demoChannelsDisabled();
  if (disabled) return disabled;
  try {
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    const messages = await loadMailbox();
    const message = parsed.success ? messages.find((m) => m.id === parsed.data.mensaje) : undefined;
    if (!message) return unknownCase("Ese mensaje no está en la bandeja");
    return await deliverDatasetFile({
      id: message.id,
      file: message.file,
      channel: "inbox",
      receiptKey: mailboxReceiptKey(message.id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
