import { describe, expect, it } from "vitest";

import { TelegramError, createTelegramClient } from "@/src/telegram";

/**
 * P-138: el cliente de Telegram (D24). Manda HTML con el botón pedido, valida lo que
 * responde Telegram, corta una descarga que pasa del tope y nunca deja el token del bot en
 * un error.
 */

const TOKEN = "123456:token-secreto-del-bot";

type Call = { readonly url: string; readonly body: unknown };

function fakeFetch(respond: (url: string) => Response): {
  readonly fetch: typeof fetch;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = init?.body;
    calls.push({ url, body: typeof raw === "string" ? JSON.parse(raw) : null });
    return Promise.resolve(respond(url));
  };
  return { fetch: impl, calls };
}

const ok = (result: unknown) => Response.json({ ok: true, result });

describe("cliente de Telegram (P-138)", () => {
  it("envía HTML con el botón y sin vista previa de enlaces", async () => {
    const { fetch, calls } = fakeFetch(() => ok({}));
    await createTelegramClient(TOKEN, fetch).sendMessage("42", "<b>hola</b>", {
      text: "Abrir",
      url: "https://yunque.app/facturas/1",
    });
    expect(calls[0]?.body).toEqual({
      chat_id: "42",
      text: "<b>hola</b>",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: "Abrir", url: "https://yunque.app/facturas/1" }]],
      },
    });
  });

  it("un rechazo de Telegram sale como TelegramError, sin el token", async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({ ok: false, description: "Bad Request: chat not found" }, { status: 400 }),
    );
    const error = await createTelegramClient(TOKEN, fetch)
      .sendMessage("42", "hola")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramError);
    expect(String(error)).toContain("chat not found");
    expect(String(error)).not.toContain(TOKEN);
  });

  it("descarga el archivo y corta si pasa del tope o si Telegram dice que es grande", async () => {
    const bytes = new Uint8Array(2_000).fill(7);
    const { fetch } = fakeFetch((url) =>
      url.includes("/getFile") ? ok({ file_path: "documents/f.pdf" }) : new Response(bytes),
    );
    const client = createTelegramClient(TOKEN, fetch);
    expect((await client.downloadFile("f", 5_000))?.length).toBe(2_000);
    expect(await client.downloadFile("f", 1_000)).toBeNull();

    const announced = fakeFetch(() => ok({ file_path: "f.pdf", file_size: 9_999 }));
    expect(await createTelegramClient(TOKEN, announced.fetch).downloadFile("f", 1_000)).toBeNull();
    expect(announced.calls).toHaveLength(1);
  });

  it("una respuesta de getFile con otra forma no se usa", async () => {
    const { fetch } = fakeFetch(() => ok({ path: "x" }));
    await expect(createTelegramClient(TOKEN, fetch).downloadFile("f", 1_000)).rejects.toThrow(
      TelegramError,
    );
  });
});
