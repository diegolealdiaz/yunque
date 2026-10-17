import type { Config, TelegramConfig } from "@/src/config";
import { getConfig } from "@/src/config";
import { getDatabase, type Database } from "@/src/db/client";
import { createTelegramClient, type TelegramClient } from "@/src/telegram";

/**
 * Telegram en la app (D24): el cliente del bot, uno por proceso, y el contexto del webhook.
 * El webhook no trae cookie de visitante: la empresa sale del chat conectado.
 */

let client: { readonly token: string; readonly client: TelegramClient } | undefined;

export function telegramClient(telegram: TelegramConfig): TelegramClient {
  if (client?.token !== telegram.botToken) {
    client = { token: telegram.botToken, client: createTelegramClient(telegram.botToken) };
  }
  return client.client;
}

/** Null si Telegram está apagado o fuera de la demo: la ruta responde 404. */
export async function telegramContext(): Promise<{
  readonly config: Config;
  readonly telegram: TelegramConfig;
  readonly db: Database;
} | null> {
  const config = getConfig();
  const telegram = config.demo.enabled ? config.telegram : null;
  if (telegram === null) return null;
  return { config, telegram, db: await getDatabase(config.database) };
}
