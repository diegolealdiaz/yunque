import { z } from "zod";

import { UlidSchema } from "./ids";

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
