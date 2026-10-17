import { z } from "zod";

/**
 * Cliente de la API de bots de Telegram (D24). Es el único módulo que llama a Telegram; los
 * casos de uso reciben la interfaz `TelegramClient` y las pruebas usan uno simulado.
 *
 * - El token del bot va en la URL de cada llamada: ningún error ni registro la incluye.
 * - Cada llamada tiene un plazo; una descarga se corta en cuanto pasa del tope de bytes.
 * - Las respuestas de Telegram se validan con zod, como cualquier borde del sistema.
 * - Los mensajes van en HTML de Telegram: quien arma el texto ya escapó lo que viene de
 *   afuera (`src/ui/telegram.ts`).
 */

export type TelegramButton = { readonly text: string; readonly url: string };

export type TelegramClient = {
  sendMessage(chatId: string, html: string, button?: TelegramButton): Promise<void>;
  /** Descarga un archivo que mandaron al bot. Null si pasa de `maxBytes`. */
  downloadFile(fileId: string, maxBytes: number): Promise<Uint8Array | null>;
};

export class TelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramError";
  }
}

const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

/** Envoltura de toda respuesta de la API de bots. */
const ApiResponseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().max(500).optional(),
});

/** Resultado de `getFile`: dónde descargar el archivo y cuánto pesa. */
const FileResultSchema = z.object({
  file_path: z.string().min(1).max(500),
  file_size: z.number().int().nonnegative().optional(),
});

/** Lee un cuerpo de respuesta sin pasar de `maxBytes`; null si es más grande. */
async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export function createTelegramClient(
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): TelegramClient {
  async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${API}/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new TelegramError(`Telegram no respondió a ${method}`);
    }
    const parsed = ApiResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || !parsed.data.ok) {
      const detail =
        parsed.success && parsed.data.description ? `: ${parsed.data.description}` : "";
      throw new TelegramError(`Telegram rechazó ${method} (${String(response.status)})${detail}`);
    }
    return parsed.data.result;
  }

  return {
    async sendMessage(chatId, html, button) {
      await call("sendMessage", {
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
      });
    },

    async downloadFile(fileId, maxBytes) {
      const file = FileResultSchema.safeParse(await call("getFile", { file_id: fileId }));
      if (!file.success) throw new TelegramError("Telegram no entregó el archivo");
      const { file_path: path, file_size: size } = file.data;
      if (size !== undefined && size > maxBytes) return null;
      let response: Response;
      try {
        response = await fetchImpl(`${API}/file/bot${botToken}/${path}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new TelegramError("No se pudo descargar el archivo de Telegram");
      }
      if (!response.ok || !response.body) {
        throw new TelegramError(`No se pudo descargar el archivo (${String(response.status)})`);
      }
      return readCapped(response.body, maxBytes);
    },
  };
}
