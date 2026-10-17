import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { TelegramLinkTokenSchema, type Notification } from "@/src/domain";
import { newTelegramLinkToken } from "@/src/session";
import type { TelegramClient, TelegramUpdate } from "@/src/telegram";
import {
  createTelegramLink,
  grantDemoAccess,
  handleTelegramUpdate,
  loadTelegramStatus,
  telegramSender,
  type TelegramUpdateDeps,
} from "@/src/usecases";
import { notificationsFor } from "@/src/usecases/record-decision";

import { generatedFile } from "../extraction/helpers";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-129 y P-135 a P-137: Telegram (D24). Solo un enlace de un solo uso, generado con el
 * acceso de jurado, conecta un chat; el bot no atiende chats desconocidos ni grupos; la
 * misma actualización dos veces procesa una vez; el cupo del chat aguanta una ráfaga; la
 * decisión de una factura enviada al bot llega por la cola de avisos a los chats conectados.
 */

const NOW = new Date("2026-10-17T12:00:00.000Z");
const SINCE = "2026-10-17T05:00:00.000Z";
const CODE = "codigo-de-jurado-2026";

type Sent = { readonly chatId: string; readonly html: string; readonly button?: string };

/** Cliente de Telegram simulado: guarda lo que se envía y entrega el archivo que se le da. */
function fakeClient(file: Uint8Array | null = null): TelegramClient & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    sendMessage: (chatId, html, button) => {
      sent.push({ chatId, html, ...(button ? { button: button.url } : {}) });
      return Promise.resolve();
    },
    downloadFile: () => Promise.resolve(file),
  };
}

let p: Pipeline;
let pdf: Uint8Array;
let updates = 0;

beforeAll(async () => {
  p = await openPipeline();
  pdf = await generatedFile("camila_email.pdf");
}, 60_000);

afterAll(async () => {
  await p.close();
});

function deps(client: TelegramClient, maxPerChatPerDay = 10): TelegramUpdateDeps {
  return {
    db: p.t.db,
    client,
    now: NOW,
    since: SINCE,
    maxPerChatPerDay,
    invoiceLimits: { perOrganization: 500, global: 5000 },
    process: p.deps,
  };
}

function message(
  chatId: number,
  extra: Partial<NonNullable<TelegramUpdate["message"]>> = {},
  updateId = ++updates,
): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(NOW.getTime() / 1000),
      chat: { id: chatId, type: "private" },
      from: { first_name: "Jurado" },
      ...extra,
    },
  };
}

const document = { file_id: "archivo", file_name: "factura.pdf", file_size: 1000 };

async function linkChat(chatId: number): Promise<void> {
  const grant = await grantDemoAccess(p.t.db, {
    organizationId: p.organizationId,
    code: CODE,
    expectedCode: CODE,
    ttlHours: 72,
    now: NOW,
    newId: p.t.newId,
  });
  const { url } = await createTelegramLink(p.t.db, {
    organizationId: p.organizationId,
    grant,
    botUsername: "YunqueBot",
    now: NOW,
    newToken: newTelegramLinkToken,
  });
  const token = url.slice(url.indexOf("start=") + "start=".length);
  const outcome = await handleTelegramUpdate(
    deps(fakeClient()),
    message(chatId, { text: `/start ${token}` }),
  );
  expect(outcome.kind).toBe("linked");
}

describe("conectar un chat (P-135)", () => {
  it("un chat desconocido recibe «bot privado» y no escribe nada; un grupo se ignora", async () => {
    const client = fakeClient(pdf);
    const outcome = await handleTelegramUpdate(deps(client), message(1001, { document }));
    expect(outcome).toEqual({ kind: "private", organizationId: null });
    expect(client.sent[0]?.html).toContain("Este bot es privado");
    expect(await repos.findTelegramUpdate(p.t.db, updates)).toBeNull();

    const group = await handleTelegramUpdate(deps(client), {
      update_id: ++updates,
      message: { message_id: 1, date: 0, chat: { id: -5, type: "group" }, text: "/start" },
    });
    expect(group.kind).toBe("ignored");
  });

  it("el enlace se genera con el acceso de jurado, conecta una vez y vence", async () => {
    const grant = await grantDemoAccess(p.t.db, {
      organizationId: p.organizationId,
      code: CODE,
      expectedCode: CODE,
      ttlHours: 72,
      now: NOW,
      newId: p.t.newId,
    });
    const link = await createTelegramLink(p.t.db, {
      organizationId: p.organizationId,
      grant,
      botUsername: "YunqueBot",
      now: NOW,
      newToken: newTelegramLinkToken,
    });
    expect(link.url).toMatch(/^https:\/\/t\.me\/YunqueBot\?start=[a-z2-7]{16}$/);
    expect(link.expiresAt).toBe("2026-10-17T13:00:00.000Z");
    const token = link.url.slice(link.url.indexOf("start=") + 6);
    expect(TelegramLinkTokenSchema.safeParse(token).success).toBe(true);

    const client = fakeClient();
    const first = await handleTelegramUpdate(
      deps(client),
      message(2002, { text: `/start ${token}` }),
    );
    expect(first).toEqual({ kind: "linked", organizationId: p.organizationId });
    expect(client.sent.at(-1)?.html).toContain("quedó conectado");
    // Otro chat no puede reusar el mismo enlace.
    const reuse = await handleTelegramUpdate(
      deps(client),
      message(2003, { text: `/start ${token}` }),
    );
    expect(reuse.kind).toBe("link_invalid");
    expect(await repos.findTelegramChat(p.t.db, "2003")).toBeNull();

    // Un enlace vencido no conecta.
    const late = await createTelegramLink(p.t.db, {
      organizationId: p.organizationId,
      grant,
      botUsername: "YunqueBot",
      now: new Date("2026-10-16T00:00:00.000Z"),
      newToken: newTelegramLinkToken,
    });
    const lateToken = late.url.slice(late.url.indexOf("start=") + 6);
    const expired = await handleTelegramUpdate(
      deps(client),
      message(2004, { text: `/start ${lateToken}` }),
    );
    expect(expired.kind).toBe("link_invalid");
    expect((await loadTelegramStatus(p.t.db, p.organizationId)).chats).toBe(1);
  });

  it("/salir desconecta el chat", async () => {
    await linkChat(2005);
    const client = fakeClient();
    expect((await handleTelegramUpdate(deps(client), message(2005, { text: "/salir" }))).kind).toBe(
      "unlinked",
    );
    expect((await handleTelegramUpdate(deps(client), message(2005, { text: "hola" }))).kind).toBe(
      "private",
    );
  });
});

describe("facturas por el bot (P-129, P-136)", () => {
  it("procesa la factura por el canal Telegram, una sola vez, y avisa por la cola", async () => {
    await linkChat(3001);
    const fixture = await datasetCase("camila_email");
    p.client.next = fixture.modelOutput;
    const client = fakeClient(pdf);
    const update = message(3001, { document, caption: "Factura de octubre" });
    const outcome = await handleTelegramUpdate(deps(client), update);
    expect(outcome.kind).toBe("processed");
    expect(client.sent.map((s) => s.html)).toContain(
      "Recibida. La estoy revisando; en unos segundos te digo qué decidió el agente.",
    );
    const invoice = await repos.findInvoiceByReceiptKey(
      p.t.db,
      p.organizationId,
      `telegram:${String(update.update_id)}`,
    );
    expect(invoice?.channel).toBe("telegram");

    // Telegram reintenta la misma actualización: no se procesa otra vez.
    expect((await handleTelegramUpdate(deps(client), update)).kind).toBe("duplicate");

    // La decisión se avisa por Telegram, y el aviso lo entrega el canal real.
    const queued = (await repos.listNotifications(p.t.db, p.organizationId)).filter(
      (n) => n.channel === "telegram" && n.payload["invoice_id"] === invoice?.id,
    );
    expect(queued).toHaveLength(1);
    const notification = queued[0];
    if (!notification) throw new Error("sin aviso");
    const bot = fakeClient();
    const send = telegramSender({ db: p.t.db, client: bot, publicAppUrl: "https://yunque.app" });
    expect(await send(notification)).toEqual({ simulated: false });
    const chats = new Set(bot.sent.map((s) => s.chatId));
    expect(chats.has("3001")).toBe(true);
    expect(bot.sent[0]?.html).toContain(invoice?.reference ?? "?");
    expect(bot.sent[0]?.button).toBe(`https://yunque.app/facturas/${invoice?.id ?? ""}`);
  });

  it("con un chat conectado se avisa lo que importa a una persona, no los pagos del agente", async () => {
    const [invoice] = await repos.listInvoices(p.t.db, p.organizationId, { limit: 1 });
    if (!invoice) throw new Error("sin facturas");
    const decision = await repos.getLatestDecision(p.t.db, p.organizationId, invoice.id);
    if (!decision) throw new Error("sin decisión");
    const channels = (over: Partial<typeof decision>, telegramLinked: boolean) =>
      notificationsFor({
        decision: { ...decision, ...over },
        invoice,
        channel: "upload",
        telegramLinked,
        newId: p.t.newId,
        nowIso: NOW.toISOString(),
      }).map((n) => n.channel);
    expect(channels({ verdict: "pagar", actor: { kind: "agente" } }, true)).toEqual(["pantalla"]);
    expect(channels({ verdict: "escalar", actor: { kind: "agente" } }, true)).toEqual([
      "pantalla",
      "telegram",
    ]);
    expect(channels({ verdict: "frenar", actor: { kind: "agente" } }, false)).toEqual(["pantalla"]);
    expect(channels({ verdict: "pagar", actor: { kind: "humano", name: "Ana" } }, true)).toEqual([
      "pantalla",
      "telegram",
    ]);
  });

  it("el cupo del chat aguanta una ráfaga y un archivo que no es factura no se procesa", async () => {
    await linkChat(4001);
    const client = fakeClient(new TextEncoder().encode("hola, no soy un PDF"));
    const burst = await Promise.all(
      Array.from({ length: 5 }, () =>
        handleTelegramUpdate(deps(client, 2), message(4001, { document })),
      ),
    );
    const kinds = burst.map((o) => o.kind).sort();
    expect(kinds).toEqual(["limit", "limit", "limit", "not_processed", "not_processed"]);
    expect(client.sent.some((s) => s.html.includes("máximo de 2 facturas"))).toBe(true);
  });

  it("un archivo más grande que el tope se rechaza sin descargarlo", async () => {
    await linkChat(4002);
    const client = fakeClient(pdf);
    const outcome = await handleTelegramUpdate(
      deps(client),
      message(4002, { document: { ...document, file_size: 50 * 1024 * 1024 } }),
    );
    expect(outcome.kind).toBe("too_large");
  });

  it("sin chats conectados, el aviso por Telegram queda simulado", async () => {
    const t = await openPipeline();
    try {
      const send = telegramSender({ db: t.t.db, client: fakeClient(), publicAppUrl: null });
      const notification: Notification = {
        id: t.t.newId(),
        organization_id: t.organizationId,
        channel: "telegram",
        idempotency_key: "decision:x:telegram",
        payload: {},
        status: "pendiente",
        attempts: 0,
        next_attempt_at: null,
        last_error: null,
        created_at: NOW.toISOString(),
        updated_at: NOW.toISOString(),
      };
      expect(await send(notification)).toEqual({ simulated: true });
    } finally {
      await t.close();
    }
  });
});
