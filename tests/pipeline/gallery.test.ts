import { access } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GALLERY, GALLERY_PREVIEW_DIR, channelOfFormat, datasetReceiptKey } from "@/src/dataset";
import { loadGalleryInvoices, processInvoice } from "@/src/usecases";

import { datasetCases, openPipeline, type CaseFixture, type Pipeline } from "./helpers";

/**
 * P-146: la galería de "Probar el agente". Cada caso existe en el lote, tiene su miniatura, y
 * procesado solo y en cualquier orden decide lo mismo que espera el manifiesto: la tarjeta
 * no promete un caso que dependa de lo que se probó antes.
 */
let p: Pipeline;
let fixtures: CaseFixture[];

const keyOf = (f: CaseFixture) => datasetReceiptKey({ id: f.case.id, format: f.case.format });

beforeAll(async () => {
  p = await openPipeline();
  const all = await datasetCases();
  fixtures = GALLERY.map((g) => {
    const found = all.find((f) => f.case.id === g.id);
    if (!found) throw new Error(`La galería nombra ${g.id}, que no está en el lote`);
    return found;
  });
}, 60_000);

afterAll(async () => {
  await p.close();
});

describe("probar el agente (P-146)", () => {
  it("cada caso tiene su miniatura", async () => {
    for (const { id } of GALLERY) {
      await expect(
        access(path.join(process.cwd(), "public", GALLERY_PREVIEW_DIR, `${id}.png`)),
      ).resolves.toBeUndefined();
    }
  });

  it("en orden inverso y uno a uno, cada caso decide lo que espera el manifiesto", async () => {
    expect(await loadGalleryInvoices(p.t.db, p.organizationId, fixtures.map(keyOf))).toEqual(
      new Map(),
    );
    for (const f of [...fixtures].reverse()) {
      p.client.next = f.modelOutput;
      const result = await processInvoice(p.deps, {
        ...p.input(f.bytes, keyOf(f), f.fileName),
        channel: channelOfFormat(f.case.format),
      });
      expect(result.decision?.verdict, f.case.id).toBe(f.case.expected.verdict);
    }
    const done = await loadGalleryInvoices(p.t.db, p.organizationId, fixtures.map(keyOf));
    expect(done.size).toBe(GALLERY.length);
    for (const f of fixtures) expect(done.get(keyOf(f))?.verdict).toBe(f.case.expected.verdict);
  }, 120_000);
});
