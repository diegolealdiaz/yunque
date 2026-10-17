import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * P-140: las rutas de los canales de jurado (D23, D24), invocadas como las invoca Next, con
 * una base temporal. Solo se simulan las piezas de Next que no existen fuera de una petición
 * (cookies, `after`, `connection`) y la red hacia Telegram.
 *
 * - `/api/acceso`: mismo origen, código equivocado, límite de intentos, acceso correcto.
 * - `/api/telegram/enlace`: solo con acceso.
 * - `/api/correo/entrante`: autenticación básica, cuerpo inválido, token desconocido, correo
 *   admitido que termina en factura.
 * - `/api/telegram`: secreto, cuerpo inválido, chat desconocido, conexión con el enlace.
 */

const state = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  cookie: undefined as string | undefined,
  telegram: [] as { method: string; body: Record<string, unknown> }[],
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    // Fuera de una petición de Next no hay "después de responder": se corre y se espera aparte.
    after: (task: unknown) => {
      state.pending.push(
        Promise.resolve().then(() => (typeof task === "function" ? task() : task)),
      );
    },
    connection: () => Promise.resolve(),
  };
});

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "yq_visitante" && state.cookie ? { value: state.cookie } : undefined,
    }),
}));

const SESSION_SECRET = "s".repeat(64);
const ACCESS_CODE = "codigo-jurado-de-prueba";
const MAIL_SECRET = "correo-webhook-de-prueba-0123456789";
const TG_SECRET = "telegram_webhook_de_prueba_0123456789";
const ORIGIN = "http://localhost:3000";

let dir: string;
let routes: {
  acceso: typeof import("@/app/api/acceso/route");
  enlace: typeof import("@/app/api/telegram/enlace/route");
  correo: typeof import("@/app/api/correo/entrante/route");
  telegram: typeof import("@/app/api/telegram/route");
};
let session: typeof import("@/src/session");

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "yunque-api-"));
  const url = `file:${path.join(dir, "api.db")}`;
  Object.assign(process.env, {
    DATABASE_URL: url,
    APPROVAL_SIGNING_SECRET: "a".repeat(64),
    SESSION_SECRET,
    SYSTEM_HARD_CAP_USD_CENTS: "10000000",
    DEMO_MODE: "true",
    OPENROUTER_API_KEY: "",
    DEMO_ACCESS_CODE: ACCESS_CODE,
    INBOUND_EMAIL_ENABLED: "true",
    INBOUND_EMAIL_ADDRESS: "demo@inbound.postmarkapp.com",
    INBOUND_EMAIL_WEBHOOK_SECRET: MAIL_SECRET,
    TELEGRAM_BOT_TOKEN: "123:bot-de-prueba",
    TELEGRAM_WEBHOOK_SECRET: TG_SECRET,
    TELEGRAM_BOT_USERNAME: "YunquePruebaBot",
  });
  const { createDatabase, runMigrations, closeDatabase } = await import("@/src/db/client");
  const db = await createDatabase({ url });
  await runMigrations(db);
  closeDatabase(db);

  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    state.telegram.push({ method: href.split("/").at(-1) ?? "", body });
    return Promise.resolve(Response.json({ ok: true, result: {} }));
  });

  session = await import("@/src/session");
  routes = {
    acceso: await import("@/app/api/acceso/route"),
    enlace: await import("@/app/api/telegram/enlace/route"),
    correo: await import("@/app/api/correo/entrante/route"),
    telegram: await import("@/app/api/telegram/route"),
  };
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

/** Corre lo que la ruta dejó para después de responder. */
async function settle(): Promise<void> {
  const tasks = state.pending.splice(0);
  await Promise.all(tasks);
}

/** Un visitante nuevo, con su cookie firmada. */
function newVisitor(): void {
  state.cookie = session.signVisitor(session.newVisitorId(), SESSION_SECRET);
}

function post(
  route: string,
  body: unknown,
  headers: Record<string, string> = { origin: ORIGIN },
): Request {
  return new Request(`${ORIGIN}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-host": "localhost:3000",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const basic = (pass: string) => `Basic ${Buffer.from(`yunque:${pass}`).toString("base64")}`;

describe("acceso de jurado (P-140)", () => {
  it("exige el mismo origen, limita los intentos y da acceso con el código correcto", async () => {
    newVisitor();
    const foreign = await routes.acceso.POST(
      post("/api/acceso", { codigo: ACCESS_CODE }, { origin: "https://otro.sitio" }),
    );
    expect(foreign.status).toBe(403);

    for (let i = 0; i < 5; i++) {
      const wrong = await routes.acceso.POST(post("/api/acceso", { codigo: `malo-${String(i)}` }));
      expect(wrong.status).toBe(403);
    }
    expect((await routes.acceso.POST(post("/api/acceso", { codigo: ACCESS_CODE }))).status).toBe(
      429,
    );

    newVisitor();
    const enlaceSinAcceso = await routes.enlace.POST(post("/api/telegram/enlace", {}));
    expect(enlaceSinAcceso.status).toBe(403);
    const ok = await routes.acceso.POST(post("/api/acceso", { codigo: ACCESS_CODE }));
    expect(ok.status).toBe(200);
    const body: unknown = await ok.json();
    expect(body).toMatchObject({
      email: { address: expect.stringMatching(/^demo\+[a-z2-7]{12}@inbound\.postmarkapp\.com$/) },
    });
    const link: unknown = await (await routes.enlace.POST(post("/api/telegram/enlace", {}))).json();
    expect(link).toMatchObject({
      url: expect.stringMatching(/^https:\/\/t\.me\/YunquePruebaBot\?start=[a-z2-7]{16}$/),
    });
  });
});

describe("webhook del correo (P-140)", () => {
  it("rechaza sin la contraseña, ignora lo inválido y admite un correo a una dirección real", async () => {
    newVisitor();
    const access: unknown = await (
      await routes.acceso.POST(post("/api/acceso", { codigo: ACCESS_CODE }))
    ).json();
    const address =
      typeof access === "object" && access !== null && "email" in access
        ? JSON.stringify(access.email)
        : "";
    const token = /\+([a-z2-7]{12})@/.exec(address)?.[1] ?? "";
    expect(token).not.toBe("");

    const email = (hash: string) => ({
      MessageID: `m-${hash}`,
      MailboxHash: hash,
      From: "jurado@ejemplo.co",
      Subject: "Hola",
      TextBody: "Sin factura",
      Attachments: [],
    });
    const call = (body: unknown, auth?: string) =>
      routes.correo.POST(post("/api/correo/entrante", body, auth ? { authorization: auth } : {}));

    expect((await call(email(token))).status).toBe(401);
    expect((await call(email(token), basic("otra"))).status).toBe(401);
    expect(await (await call("{no es json", basic(MAIL_SECRET))).json()).toEqual({
      status: "invalid",
    });
    expect(await (await call(email("aaaaaaaaaaaa"), basic(MAIL_SECRET))).json()).toEqual({
      status: "ignored",
    });
    expect(await (await call(email(token), basic(MAIL_SECRET))).json()).toEqual({
      status: "accepted",
    });
    await settle();
  });
});

describe("webhook de Telegram (P-140)", () => {
  it("exige el secreto, responde «privado» a un chat desconocido y conecta con el enlace", async () => {
    const update = (id: number, text: string) => ({
      update_id: id,
      message: { message_id: id, date: 0, chat: { id: 777, type: "private" }, text },
    });
    const call = (body: unknown, secret?: string) =>
      routes.telegram.POST(
        post("/api/telegram", body, secret ? { "x-telegram-bot-api-secret-token": secret } : {}),
      );

    expect((await call(update(1, "hola"))).status).toBe(401);
    expect((await call(update(1, "hola"), "otro_secreto_cualquiera_0123456789")).status).toBe(401);
    expect(await (await call({ sin: "forma" }, TG_SECRET)).json()).toEqual({ status: "invalid" });

    state.telegram.length = 0;
    expect((await call(update(2, "hola"), TG_SECRET)).status).toBe(200);
    await settle();
    expect(state.telegram[0]).toMatchObject({ method: "sendMessage", body: { chat_id: "777" } });
    expect(String(state.telegram[0]?.body["text"])).toContain("Este bot es privado");

    newVisitor();
    await routes.acceso.POST(post("/api/acceso", { codigo: ACCESS_CODE }));
    const link: unknown = await (await routes.enlace.POST(post("/api/telegram/enlace", {}))).json();
    const url = typeof link === "object" && link !== null && "url" in link ? String(link.url) : "";
    const token = url.slice(url.indexOf("start=") + "start=".length);
    state.telegram.length = 0;
    await call(update(3, `/start ${token}`), TG_SECRET);
    await settle();
    expect(String(state.telegram[0]?.body["text"])).toContain("quedó conectado");
  });
});
