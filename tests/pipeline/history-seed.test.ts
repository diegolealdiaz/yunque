import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SAMPLE_PREFIX, loadDemoSeed, loadGroundTruth } from "@/src/dataset";
import { listEvents, listInvoices } from "@/src/db/repositories";
import { loadSeedData, seedDatasetOrganization } from "@/src/db/seed";
import type { Invoice, Ulid } from "@/src/domain";
import { BundledFileStorage, MemoryFileStorage } from "@/src/extraction";
import { describeEvent } from "@/src/ui/audit";
import { loadInvoiceDetail, pngSize } from "@/src/usecases";

import { openTestDatabase, type TestDatabase } from "../db/helpers";

/**
 * P-145: el historial de ejemplo se ve como el lote. Cada factura trae su documento (páginas
 * servidas desde el dataset, sin escribir archivos) y su lectura; la que no se pagó dice por
 * qué con los mismos valores que el motor, y la que aprobó una persona lo deja en la bitácora.
 */
let t: TestDatabase;
let organizationId: Ulid;
let invoices: readonly Invoice[];
const storage = new BundledFileStorage(
  SAMPLE_PREFIX,
  path.join(process.cwd(), "data", "dataset", "generado"),
  new MemoryFileStorage(),
);

const byFile = (name: string) => {
  const found = invoices.find((i) => i.original_name === name);
  if (!found) throw new Error(`Falta ${name}`);
  return found;
};

beforeAll(async () => {
  t = await openTestDatabase();
  const [data, seed] = await Promise.all([loadSeedData(), loadDemoSeed()]);
  const seeded = await seedDatasetOrganization(t.db, {
    data,
    newId: t.newId,
    now: t.now,
    systemHardCapUsdCents: 10_000_000,
    visitorId: null,
    history: seed.history,
    historyDocuments: seed.historyDocuments,
    committedUsdCents: seed.committedUsdCents,
    today: seed.today,
  });
  organizationId = seeded.organization.id;
  invoices = await listInvoices(t.db, organizationId, { limit: 100 });
}, 60_000);

afterAll(async () => {
  await t.close();
});

describe("historial de ejemplo (P-145)", () => {
  it("cada factura del historial trae su documento generado y su lectura", async () => {
    const [seed, truth] = await Promise.all([loadDemoSeed(), loadGroundTruth()]);
    expect(invoices).toHaveLength(seed.history.length);
    for (const entry of seed.history) {
      const invoice = byFile(`${entry.invoice_number}.pdf`);
      const generated = truth.history.find((h) => h.invoice_number === entry.invoice_number);
      expect(invoice.document_hash, entry.invoice_number).toBe(generated?.document_hash);
      expect(invoice.page_keys.length).toBeGreaterThan(0);
      const page = invoice.page_keys[0];
      if (!page) throw new Error("sin página");
      expect(pngSize(await storage.get(page))).not.toBeNull();
    }
    const detail = await loadInvoiceDetail(t.db, storage, organizationId, byFile("F-2270.pdf").id);
    expect(detail.fromHistory).toBe(true);
    expect(detail.fields.find((f) => f.name === "invoice_number")?.value).toBe("F-2270");
    // Las citas se enmarcan sobre la página, como en el lote.
    expect(detail.fields.some((f) => f.box !== null)).toBe(true);
  });

  it("la frenada dice por qué: la cuenta del documento no es la registrada", async () => {
    const invoice = byFile("INV-10369.pdf");
    const detail = await loadInvoiceDetail(t.db, storage, organizationId, invoice.id);
    expect(detail.decision?.verdict).toBe("frenar");
    expect(detail.decision?.findings).toEqual([
      expect.objectContaining({
        code: "bank_account_mismatch",
        action: "frenar",
        observed: "****4471",
        threshold: "****6789",
        field: "bank_account",
      }),
    ]);
    const decided = (await listEvents(t.db, organizationId, { invoiceId: invoice.id }))[0];
    expect(decided && describeEvent(decided.type, decided.data)).toEqual({
      title: "Frenó la factura",
      detail: "La cuenta de pago no es la registrada del beneficiario",
      tone: "hold",
    });
  });

  it("la escalada que aprobó una persona queda con su regla y su aprobación", async () => {
    const invoice = byFile("AH-5535.pdf");
    const detail = await loadInvoiceDetail(t.db, storage, organizationId, invoice.id);
    expect(invoice.status).toBe("aprobada");
    expect(detail.decision?.findings.map((f) => f.code)).toEqual([
      "amount_over_approval_threshold",
    ]);
    const events = await listEvents(t.db, organizationId, { invoiceId: invoice.id });
    expect(events.map((e) => [e.type, e.actor.kind])).toEqual([
      ["invoice.approved", "humano"],
      ["invoice.escalated", "agente"],
    ]);
  });

  it("el almacenamiento del dataset es de solo lectura", async () => {
    await expect(
      storage.put(`${SAMPLE_PREFIX}/historial/x.png`, new Uint8Array([1]), "image/png"),
    ).rejects.toThrow(/solo lectura/);
  });
});
