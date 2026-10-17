import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "@/src/config";

/**
 * El lote y la bandeja son canales de la demo: con la demo apagada responden 404 y no tocan
 * la base, así una petición del mismo origen no mete facturas ficticias en la empresa real.
 */

/** Configuración mínima válida de prueba, con la demo apagada. Valores ficticios. */
const PRODUCT_ENV = vi.hoisted(() => ({
  NODE_ENV: "test",
  DATABASE_URL: "file:./data/no-se-usa.db",
  APPROVAL_SIGNING_SECRET: "a".repeat(64),
  SESSION_SECRET: "b".repeat(64),
  SYSTEM_HARD_CAP_USD_CENTS: "10000000",
  DEMO_MODE: "false",
}));

vi.mock("@/src/config", async (original) => {
  const actual = await original<typeof import("@/src/config")>();
  const config = actual.loadConfig(PRODUCT_ENV);
  return { ...actual, getConfig: () => config };
});

function post(body: unknown): Request {
  return new Request("http://localhost:3000/api", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("canales de la demo con la demo apagada", () => {
  it("la configuración de la prueba tiene la demo apagada", () => {
    expect(loadConfig(PRODUCT_ENV).demo.enabled).toBe(false);
  });

  it("/api/lote y /api/bandeja responden 404", async () => {
    const { POST: batch } = await import("@/app/api/lote/route");
    const { POST: mailbox } = await import("@/app/api/bandeja/route");
    for (const response of [
      await batch(post({ caso: "nube_oct" })),
      await mailbox(post({ mensaje: "camila_email" })),
    ]) {
      expect(response.status).toBe(404);
      const json: unknown = await response.json();
      expect(json).toMatchObject({ error: { code: "not_found" } });
    }
  });
});
