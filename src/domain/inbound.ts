import { z } from "zod";

import { receiptKeyFor, type ReceiptKey } from "./invoice";

/**
 * Correo real de entrada (D23): las piezas que comparten el webhook, la base y la sesión.
 *
 * - El token de una dirección es la parte después del + (`local+token@dominio`): 12
 *   caracteres base32 en minúscula, válidos en cualquier dirección de correo.
 * - Cada correo que llega a una dirección conocida deja un recibo: admitido (ocupa cupo del
 *   día) o rechazado con su motivo. El recibo se identifica por el id que el proveedor da al
 *   correo, así un reintento del proveedor encuentra el mismo recibo.
 */

export const InboundTokenSchema = z.string().regex(/^[a-z2-7]{12}$/, { error: "Token inválido" });

/** Id que el proveedor de correo da a cada mensaje: estable entre reintentos. */
export const InboundMessageIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,100}$/);

export const InboundRejectReasonSchema = z.enum([
  /** La dirección ya venció. */
  "expired",
  /** La dirección llegó a su máximo de correos del día. */
  "address_limit",
  /** La demo llegó a su máximo de correos del día. */
  "daily_limit",
  /** Se llegó al máximo de facturas del día (por visitante o de la demo). */
  "invoice_limit",
  /** El correo se admitió, pero el proceso falló después de responder al proveedor. */
  "failed",
]);
export type InboundRejectReason = z.infer<typeof InboundRejectReasonSchema>;

/** Prefijo del id de entrega de un correo real dentro de su llave de recepción. */
export const INBOUND_DELIVERY_PREFIX = "pm-";

/** Llave de recepción de un correo real: `inbox:pm-<id del proveedor>`. */
export function inboundReceiptKey(messageId: string): ReceiptKey {
  return receiptKeyFor("inbox", `${INBOUND_DELIVERY_PREFIX}${messageId}`);
}
