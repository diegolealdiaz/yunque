import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACCESS_ATTEMPT_WINDOW_MS,
  MAX_ACCESS_ATTEMPTS,
  activeAccess,
  grantDemoAccess,
  requireAccess,
} from "@/src/usecases";

import { openPipeline, type Pipeline } from "./helpers";

/**
 * P-139: el acceso de jurado (D23, D24). El código correcto da acceso por un tiempo fijo que
 * no se extiende; los intentos fallidos se limitan por empresa, y durante el bloqueo ni el
 * código correcto pasa.
 */

const CODE = "codigo-de-jurado-2026";
const NOW = new Date("2026-10-17T12:00:00.000Z");

let p: Pipeline;

beforeAll(async () => {
  p = await openPipeline();
}, 60_000);

afterAll(async () => {
  await p.close();
});

const attempt = (code: string, now = NOW) =>
  grantDemoAccess(p.t.db, {
    organizationId: p.organizationId,
    code,
    expectedCode: CODE,
    ttlHours: 72,
    now,
    newId: p.t.newId,
  });

describe("acceso de jurado (P-139)", () => {
  it("sin acceso, las acciones de jurado se rechazan", async () => {
    expect(await activeAccess(p.t.db, p.organizationId, NOW)).toBeNull();
    await expect(requireAccess(p.t.db, p.organizationId, NOW)).rejects.toMatchObject({
      code: "not_authorized",
    });
  });

  it("bloquea tras demasiados intentos fallidos, aun con el código correcto, hasta que pasa la ventana", async () => {
    for (let i = 0; i < MAX_ACCESS_ATTEMPTS; i++) {
      await expect(attempt(`equivocado-${String(i)}`)).rejects.toMatchObject({
        code: "not_authorized",
      });
    }
    await expect(attempt(CODE)).rejects.toMatchObject({ code: "limit_reached" });

    const later = new Date(NOW.getTime() + ACCESS_ATTEMPT_WINDOW_MS + 1000);
    const grant = await attempt(CODE, later);
    expect(grant.expiresAt).toBe(new Date(later.getTime() + 72 * 3_600_000).toISOString());
    expect(await requireAccess(p.t.db, p.organizationId, later)).toEqual(grant);
  });
});
