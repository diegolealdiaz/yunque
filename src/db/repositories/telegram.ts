import { and, count, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";

import { TelegramChatIdSchema, TelegramLinkTokenSchema, UlidSchema, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { parseRow } from "../rows";
import { telegramChats, telegramLinkTokens, telegramUpdates } from "../schema";

/**
 * Telegram (D24): chats conectados, enlaces de conexión de un solo uso y las facturas que
 * llegan por el bot. Buscar por chat o por token es la entrada a una empresa, como buscar
 * por visitante: el chat lo identifica Telegram y el token sale de un enlace que generó la
 * empresa, nunca de algo que el cliente elija.
 */

const TelegramChatSchema = z.strictObject({
  chatId: TelegramChatIdSchema,
  organizationId: UlidSchema,
  linkedAt: z.iso.datetime(),
});
export type TelegramChat = Readonly<z.infer<typeof TelegramChatSchema>>;

const TelegramLinkSchema = z.strictObject({
  token: TelegramLinkTokenSchema,
  organizationId: UlidSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  usedAt: z.iso.datetime().nullable(),
});
export type TelegramLink = Readonly<z.infer<typeof TelegramLinkSchema>>;

const TelegramUpdateSchema = z.strictObject({
  updateId: z.number().int().nonnegative(),
  organizationId: UlidSchema,
  chatId: TelegramChatIdSchema,
  status: z.enum(["admitido", "rechazado"]),
  receivedAt: z.iso.datetime(),
});
export type TelegramUpdateRecord = Readonly<z.infer<typeof TelegramUpdateSchema>>;

export async function insertTelegramLink(exec: Executor, link: TelegramLink): Promise<void> {
  await exec.insert(telegramLinkTokens).values(TelegramLinkSchema.parse(link));
}

/**
 * Marca el enlace como usado si sigue vigente y nadie lo usó. Devuelve el enlace si esta
 * llamada lo consumió; null si no existe, venció o ya se usó.
 */
export async function consumeTelegramLink(
  exec: Executor,
  token: string,
  now: string,
): Promise<TelegramLink | null> {
  const [row] = await exec
    .update(telegramLinkTokens)
    .set({ usedAt: now })
    .where(and(eq(telegramLinkTokens.token, token), isNull(telegramLinkTokens.usedAt)))
    .returning();
  if (!row) return null;
  const link = parseRow(TelegramLinkSchema, row, "telegram_link_tokens");
  return link.expiresAt > now ? link : null;
}

/** Conecta el chat a la empresa. Un chat ya conectado a otra empresa pasa a esta. */
export async function saveTelegramChat(exec: Executor, chat: TelegramChat): Promise<void> {
  const c = TelegramChatSchema.parse(chat);
  await exec
    .insert(telegramChats)
    .values(c)
    .onConflictDoUpdate({
      target: telegramChats.chatId,
      set: { organizationId: c.organizationId, linkedAt: c.linkedAt },
    });
}

/** La empresa a la que está conectado un chat; null si no está conectado. */
export async function findTelegramChat(
  exec: Executor,
  chatId: string,
): Promise<TelegramChat | null> {
  const [row] = await exec
    .select()
    .from(telegramChats)
    .where(eq(telegramChats.chatId, chatId))
    .limit(1);
  return row ? parseRow(TelegramChatSchema, row, "telegram_chats") : null;
}

/** Los chats conectados a la empresa: a quiénes se les avisa. */
export async function listTelegramChats(
  exec: Executor,
  organizationId: Ulid,
): Promise<TelegramChat[]> {
  const rows = await exec
    .select()
    .from(telegramChats)
    .where(eq(telegramChats.organizationId, organizationId));
  return rows.map((row) => parseRow(TelegramChatSchema, row, "telegram_chats"));
}

/** Desconecta el chat de la empresa. */
export async function deleteTelegramChat(
  exec: Executor,
  organizationId: Ulid,
  chatId: string,
): Promise<void> {
  await exec
    .delete(telegramChats)
    .where(and(eq(telegramChats.organizationId, organizationId), eq(telegramChats.chatId, chatId)));
}

export async function insertTelegramUpdate(
  exec: Executor,
  update: TelegramUpdateRecord,
): Promise<void> {
  await exec.insert(telegramUpdates).values(TelegramUpdateSchema.parse(update));
}

/** La factura que llegó con ese `update_id`, si ya se recibió. */
export async function findTelegramUpdate(
  exec: Executor,
  updateId: number,
): Promise<TelegramUpdateRecord | null> {
  const [row] = await exec
    .select()
    .from(telegramUpdates)
    .where(eq(telegramUpdates.updateId, updateId))
    .limit(1);
  return row ? parseRow(TelegramUpdateSchema, row, "telegram_updates") : null;
}

/** Facturas de un chat de la empresa desde `since`, admitidas o rechazadas: base de su cupo. */
export async function countTelegramSince(
  exec: Executor,
  organizationId: Ulid,
  chatId: string,
  status: TelegramUpdateRecord["status"],
  since: string,
): Promise<number> {
  const [row] = await exec
    .select({ n: count() })
    .from(telegramUpdates)
    .where(
      and(
        eq(telegramUpdates.organizationId, organizationId),
        eq(telegramUpdates.chatId, chatId),
        eq(telegramUpdates.status, status),
        gte(telegramUpdates.receivedAt, since),
      ),
    );
  return row?.n ?? 0;
}
