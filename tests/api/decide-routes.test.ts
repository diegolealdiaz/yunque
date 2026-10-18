import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * P-127 y P-128: la API de decisión (D32), invocada como la invoca Next, con una base
 * temporal. Solo se simulan las piezas de Next que no existen fuera de una petición.
 *
 * - Sin llave, con una llave inventada o con la de otra empresa: 401 o nada que ver.
 * - Mal formada: 400 con el detalle de cada campo, nunca 500.
 * - Válida: 201 con la decisión; repetida, 200 con la misma; la llave con otros datos, 400.
 * - `/api/acceso/llave`: solo del propio sitio y con el acceso de cliente.
 */

const state = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  cookie: undefined as string | undefined,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
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
const ACCESS_CODE = "codigo-cliente-de-prueba";
const ORIGIN = "http://localhost:3000";

let dir: string;
let routes: {
  acceso: typeof import("@/app/api/acceso/route");
  llave: typeof import("@/app/api/acceso/llave/route");
  decide: typeof import("@/app/api/decide/route");
  estado: typeof import("@/app/api/decide/[reference]/route");
};
let session: typeof import("@/src/session");

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "yunque-decide-"));
  const url = `file:${path.join(dir, "api.db")}`;
  Object.assign(process.env, {
    DATABASE_URL: url,
    APPROVAL_SIGNING_SECRET: "a".repeat(64),
    SESSION_SECRET,
    SYSTEM_HARD_CAP_USD_CENTS: "10000000",
    DEMO_MODE: "true",
    OPENROUTER_API_KEY: "",
    DEMO_ACCESS_CODE: ACCESS_CODE,
    PUBLIC_APP_URL: "https://yunque.example",
  });
  const { createDatabase, runMigrations, closeDatabase } = await import("@/src/db/client");
  const db = await createDatabase({ url });
  await runMigrations(db);
  closeDatabase(db);

  session = await import("@/src/session");
  routes = {
    acceso: await import("@/app/api/acceso/route"),
    llave: await import("@/app/api/acceso/llave/route"),
    decide: await import("@/app/api/decide/route"),
    estado: await import("@/app/api/decide/[reference]/route"),
  };
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function settle(): Promise<void> {
  await Promise.all(state.pending.splice(0));
}

function post(route: string, body: BodyInit, headers: Record<string, string>): Request {
  return new Request(`${ORIGIN}${route}`, {
    method: "POST",
    headers: { "x-forwarded-host": "localhost:3000", ...headers },
    body,
  });
}

/** Un visitante nuevo con acceso de cliente y su llave de la API. */
async function visitorWithKey(): Promise<string> {
  state.cookie = session.signVisitor(session.newVisitorId(), SESSION_SECRET);
  const json = { origin: ORIGIN, "content-type": "application/json" };
  const access = await routes.acceso.POST(
    post("/api/acceso", JSON.stringify({ codigo: ACCESS_CODE }), json),
  );
  expect(access.status).toBe(200);
  const issued = await routes.llave.POST(post("/api/acceso/llave", "{}", json));
  expect(issued.status).toBe(200);
  const body = (await issued.json()) as { key: string };
  expect(body.key).toMatch(/^yq_[a-z2-7]{32}$/);
  return body.key;
}

function decideJson(key: string | null, body: unknown): Promise<Response> {
  return routes.decide.POST(
    post("/api/decide", typeof body === "string" ? body : JSON.stringify(body), {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    }),
  );
}

function status(key: string, reference: string): Promise<Response> {
  return routes.estado.GET(
    new Request(`${ORIGIN}/api/decide/${reference}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ reference }) },
  );
}

const REQUEST = {
  idempotency_key: "pago-001",
  payee_name: "Nube Andina SAS",
  payee_tax_id: "901234567-8",
  invoice_number: "NA-API-001",
  currency: "COP",
  total: "4800000.00",
  bank_account: "31245679023",
  bank_holder: "Nube Andina SAS",
  due_date: "2026-11-20",
};

let key: string;

describe("llave de la API", () => {
  it("solo del propio sitio y con el acceso de cliente", async () => {
    state.cookie = session.signVisitor(session.newVisitorId(), SESSION_SECRET);
    const foreign = await routes.llave.POST(
      post("/api/acceso/llave", "{}", { origin: "https://otro.example" }),
    );
    expect(foreign.status).toBe(403);
    const withoutAccess = await routes.llave.POST(
      post("/api/acceso/llave", "{}", { origin: ORIGIN, "content-type": "application/json" }),
    );
    expect(withoutAccess.status).toBe(403);
    key = await visitorWithKey();
  }, 60_000);
});

describe("autenticación (P-127)", () => {
  it.each([
    ["sin llave", null],
    ["con una llave inventada", `yq_${"a".repeat(32)}`],
    ["con otro esquema", "no-es-una-llave"],
  ])("%s responde 401", async (_label, candidate) => {
    const response = await decideJson(candidate, REQUEST);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });
});

describe("peticiones mal formadas (P-128)", () => {
  it.each([
    ["un JSON roto", "{no es json"],
    ["un campo desconocido", { ...REQUEST, approved_by: "CFO" }],
    ["un total numérico", { ...REQUEST, total: 4800000 }],
    ["sin beneficiario", { ...REQUEST, payee_name: undefined }],
  ])("con %s responde 400, nunca 500", async (_label, body) => {
    const response = await decideJson(key, body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_request",
    );
  });

  it("dice qué campo falla", async () => {
    const response = await decideJson(key, { ...REQUEST, total: "12,00" });
    const body = (await response.json()) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path)).toContain("total");
  });

  it("un formulario roto responde 400", async () => {
    const response = await routes.decide.POST(
      post("/api/decide", "esto no es multipart", {
        "content-type": "multipart/form-data; boundary=x",
        authorization: `Bearer ${key}`,
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("decisión (P-127)", () => {
  it("decide, repite la misma decisión y rechaza la llave con otros datos", async () => {
    const first = await decideJson(key, REQUEST);
    await settle();
    expect(first.status).toBe(201);
    const decided = (await first.json()) as {
      reference: string;
      verdict: string;
      replayed: boolean;
      headline: string;
      payment_order: { account: string } | null;
      record_url: string;
    };
    expect(decided).toMatchObject({ verdict: "pagar", replayed: false });
    expect(decided.headline).toBe("Cumple tus reglas: se puede pagar.");
    expect(decided.payment_order?.account).toBe("****9023");
    expect(decided.record_url).toMatch(/^https:\/\/yunque\.example\/facturas\//);

    const again = await decideJson(key, REQUEST);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ reference: decided.reference, replayed: true });

    const reused = await decideJson(key, { ...REQUEST, total: "1.00" });
    expect(reused.status).toBe(400);

    const current = await status(key, decided.reference);
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ reference: decided.reference, verdict: "pagar" });
  }, 60_000);

  it("la llave de otra empresa no ve sus solicitudes", async () => {
    const mine = (await (
      await decideJson(key, {
        ...REQUEST,
        idempotency_key: "pago-002",
        invoice_number: "NA-API-002",
      })
    ).json()) as { reference: string };
    const other = await visitorWithKey();
    expect((await status(other, mine.reference)).status).toBe(404);
  }, 60_000);
});
