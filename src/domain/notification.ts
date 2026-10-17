import { z } from "zod";

import { UlidSchema } from "./ids";
import { INBOUND_DELIVERY_PREFIX } from "./inbound";
import type { ReceiptKey } from "./invoice";

/**
 * Notificación: un aviso pendiente de entregar, en una tabla que funciona como cola
 * (outbox). Se escribe en la misma transacción que la decisión que la origina, así nunca
 * hay decisión sin aviso ni aviso sin decisión. La entrega con reintentos es otro proceso.
 *
 * La llave de idempotencia es única por organización: encolar dos veces el mismo aviso
 * deja una sola fila.
 */

export const NotificationChannelSchema = z.enum(["pantalla", "telegram"]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationStatusSchema = z.enum(["pendiente", "enviada", "fallida"]);
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

export const NotificationSchema = z.strictObject({
  id: UlidSchema,
  organization_id: UlidSchema,
  channel: NotificationChannelSchema,
  /** `decision:<id>:<canal>`: un aviso por decisión y canal. */
  idempotency_key: z.string().min(1).max(200),
  /** Solo identificadores y valores ya formateados; nunca el texto del documento. */
  payload: z.record(z.string(), z.unknown()),
  status: NotificationStatusSchema,
  attempts: z.number().int().min(0),
  next_attempt_at: z.iso.datetime().nullable(),
  last_error: z.string().max(1000).nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type Notification = Readonly<z.infer<typeof NotificationSchema>>;

/**
 * La factura la entregó una persona (D24): la subió en pantalla, la mandó por correo real o
 * por el bot de Telegram. Las facturas de ejemplo de la demo (lote, bandeja simulada,
 * historial) no, aunque su canal sea correo o Telegram: no se avisan una por una.
 */
export function deliveredByPerson(receiptKey: ReceiptKey): boolean {
  return (
    receiptKey.startsWith("upload:") ||
    receiptKey.startsWith("telegram:") ||
    receiptKey.startsWith(`inbox:${INBOUND_DELIVERY_PREFIX}`)
  );
}

/** La factura llegó por el bot de Telegram: su veredicto se responde en el chat. */
export function deliveredByBot(receiptKey: ReceiptKey): boolean {
  return receiptKey.startsWith("telegram:");
}
