import { z } from "zod";

import { receiptKeyFor, type ReceiptKey } from "./invoice";

/**
 * Telegram (D24): las piezas que comparten el webhook, la base y la pantalla.
 *
 * - Un chat se conecta a una empresa con un enlace de un solo uso
 *   (`t.me/<bot>?start=<token>`) que solo se genera con el acceso de jurado vigente.
 * - El token del enlace va en el comando `/start`: Telegram admite hasta 64 caracteres
 *   `A-Za-z0-9_-`; aquí son 16 en base32 minúscula, 80 bits de azar.
 * - Cada actualización de Telegram trae un `update_id` único por bot: es la identidad de la
 *   entrega, así un reintento de Telegram no procesa dos veces.
 */

export const TelegramLinkTokenSchema = z
  .string()
  .regex(/^[a-z2-7]{16}$/, { error: "Enlace de Telegram inválido" });

/** Id de un chat de Telegram, guardado como texto: puede pasar de 2^53 en el futuro. */
export const TelegramChatIdSchema = z.string().regex(/^-?[0-9]{1,20}$/);

/** Cuánto vale un enlace de conexión antes de vencer. */
export const TELEGRAM_LINK_TTL_MS = 60 * 60 * 1000;

/** Llave de recepción de una factura enviada al bot: `telegram:<update_id>`. */
export function telegramReceiptKey(updateId: number): ReceiptKey {
  return receiptKeyFor("telegram", String(updateId));
}
