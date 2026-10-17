import { existsSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GENERATED_DIR, loadBatchCases } from "@/src/dataset/demo-seed";
import { loadDatasetSources } from "@/src/dataset";
import {
  READ_DEADLINE_MS,
  UseCaseError,
  assertWithinDailyLimits,
  loadInvoiceList,
  processInvoice,
} from "@/src/usecases";

import { errorResponse, isSameOrigin } from "@/app/_data/http";
import { maxDuration as uploadMaxDuration } from "@/app/api/procesar/route";
import { maxDuration as batchMaxDuration } from "@/app/api/lote/route";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/** P-104 y P-105: archivo de facturas, entrada por subida y lote, y sus topes. */
describe("lista de facturas (P-104)", () => {
  let p: Pipeline;
  const NOW = new Date("2026-10-17T20:00:00.000Z");

  beforeAll(async () => {
    p = await openPipeline();
    for (const id of ["nube_oct", "sobre_umbral", "cuenta_distinta", "camila_email"]) {
      const f = await datasetCase(id);
      p.client.next = f.modelOutput;
      await processInvoice(p.deps, {
        ...p.input(f.bytes, `batch:${id}`, f.fileName),
        channel: id === "camila_email" ? "inbox" : "batch",
      });
    }
  }, 120_000);

  afterAll(async () => {
    await p.close();
  });

  it("trae todas, las más recientes primero, con el historial sin decisión de hoy incluido", async () => {
    const rows = await loadInvoiceList(p.t.db, p.organizationId, {}, NOW);
    expect(rows).toHaveLength(24 + 4);
    expect(rows[0]?.reference).toMatch(/^YQ-2026-10-/);
    expect(rows.every((r) => r.decided !== null)).toBe(true);
  });

  it("filtra por veredicto, estado, canal y texto", async () => {
    const paid = await loadInvoiceList(p.t.db, p.organizationId, { verdict: "pagar" }, NOW);
    expect(paid.every((r) => r.decided?.verdict === "pagar")).toBe(true);
    const waiting = await loadInvoiceList(
      p.t.db,
      p.organizationId,
      { status: "esperando_aprobacion" },
      NOW,
    );
    expect(waiting.map((r) => r.decided?.payeeName)).toEqual(["Andes Hardware SAS"]);
    const inbox = await loadInvoiceList(p.t.db, p.organizationId, { channel: "inbox" }, NOW);
    expect(inbox).toHaveLength(1);
    const search = await loadInvoiceList(
      p.t.db,
      p.organizationId,
      { query: "andes hardware" },
      NOW,
    );
    expect(search.every((r) => r.decided?.payeeName === "Andes Hardware SAS")).toBe(true);
    expect(search.length).toBeGreaterThan(0);
  });

  it("los topes del día rechazan con un mensaje claro y un 429", async () => {
    const since = "2026-10-17T05:00:00.000Z";
    const fresh = "upload:nueva-entrega";
    await assertWithinDailyLimits(
      p.t.db,
      p.organizationId,
      { perOrganization: 10, global: 100 },
      since,
      fresh,
    );
    const mine = await assertWithinDailyLimits(
      p.t.db,
      p.organizationId,
      { perOrganization: 4, global: 100 },
      since,
      fresh,
    ).catch((e: unknown) => e);
    expect(mine).toBeInstanceOf(UseCaseError);
    expect(errorResponse(mine).status).toBe(429);
    await expect(
      assertWithinDailyLimits(
        p.t.db,
        p.t.newId(),
        { perOrganization: 10, global: 4 },
        since,
        fresh,
      ),
    ).rejects.toMatchObject({ code: "limit_reached" });
  });

  it("una entrega que ya se recibió no cuenta contra el tope: devuelve la factura existente", async () => {
    const since = "2026-10-17T05:00:00.000Z";
    await expect(
      assertWithinDailyLimits(
        p.t.db,
        p.organizationId,
        { perOrganization: 1, global: 1 },
        since,
        "batch:nube_oct",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("bordes de la API", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/procesar", { method: "POST", headers });

  it("solo acepta escrituras del propio sitio", () => {
    expect(isSameOrigin(request({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(
      true,
    );
    expect(isSameOrigin(request({ origin: "https://otro.sitio", host: "localhost:3000" }))).toBe(
      false,
    );
    expect(isSameOrigin(request({ host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(request({ origin: "no es una url", host: "localhost:3000" }))).toBe(false);
  });

  it("las rutas que leen con el modelo duran más que el plazo global de lectura", () => {
    expect(uploadMaxDuration * 1000).toBeGreaterThan(READ_DEADLINE_MS);
    expect(batchMaxDuration * 1000).toBeGreaterThan(READ_DEADLINE_MS);
  });

  it("un error desconocido no expone su detalle", async () => {
    const response = errorResponse(new Error("detalle interno con datos"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("detalle interno");
  });

  it("P-105 el lote del periodo es exactamente el dataset, en orden, con archivos existentes", async () => {
    const [cases, src] = await Promise.all([loadBatchCases(), loadDatasetSources()]);
    expect(cases.map((c) => c.id)).toEqual(src.manifest.cases.map((c) => c.id));
    for (const c of cases) expect(existsSync(path.join(GENERATED_DIR, c.file)), c.id).toBe(true);
  });
});
