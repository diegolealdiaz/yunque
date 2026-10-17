import { describe, expect, it } from "vitest";

import { loadDatasetSources, pdfText } from "@/src/dataset";
import { MemoryFileStorage, ingestDocument, readInvoice } from "@/src/extraction";

import { fakeClient, generatedFile, idealExtraction, readerDeps } from "./helpers";

const limits = { maxUploadBytes: 5 * 1024 * 1024, maxPages: 5 };
const options = {
  primaryModel: "anthropic/claude-haiku-5.5",
  fallbackModel: "anthropic/claude-sonnet-5.5",
  maxOutputTokens: 1500,
  timeoutMs: 1000,
};

async function fixtures(id: string) {
  const src = await loadDatasetSources();
  const c = src.manifest.cases.find((x) => x.id === id);
  const t = c && src.templates.get(c.template);
  if (!c || !t) throw new Error(`caso ${id} ausente`);
  const storage = new MemoryFileStorage();
  const doc = await ingestDocument(
    { bytes: await generatedFile(`${id}.pdf`), originalName: `${id}.pdf`, storagePrefix: "org" },
    storage,
    limits,
  );
  const good = idealExtraction(c, t);
  const bad = structuredClone(good);
  if (bad.kind === "invoice") bad.fields.total.evidence.literal = "TOTAL: 1,00";
  return {
    storage,
    doc,
    good: JSON.stringify(good),
    bad: JSON.stringify(bad),
    text: await pdfText(await generatedFile(`${id}.pdf`)),
  };
}

describe("lectura con respaldo (P-69)", () => {
  it("sin problemas en la primera pasada no se invoca el respaldo", async () => {
    const f = await fixtures("nube_oct");
    const client = fakeClient([f.good]);
    const deps = readerDeps(client);
    const result = await readInvoice(deps, f.storage, f.doc, options);
    expect(client.requests).toHaveLength(1);
    expect(result.passes).toHaveLength(1);
    expect(result.record.fallback_used).toBe(false);
    expect(result.verification.evidence_missing).toEqual([]);
    expect(result.verification.suspicions).toEqual([]);
    // Con capa de texto, el modelo recibe el texto y además la imagen de cada página.
    const parts = client.requests[0]?.parts ?? [];
    expect(parts.some((p) => p.type === "image")).toBe(true);
    expect(parts.some((p) => p.type === "text" && p.text.includes("TOTAL: 4.800.000,00"))).toBe(
      true,
    );
  });

  it("el respaldo se invoca una sola vez, solo tras fallo del verificador, y se registra aparte", async () => {
    const f = await fixtures("nube_oct");
    const client = fakeClient([f.bad, f.good]);
    const deps = readerDeps(client);
    const result = await readInvoice(deps, f.storage, f.doc, options);
    expect(client.requests.map((r) => r.model)).toEqual([
      options.primaryModel,
      options.fallbackModel,
    ]);
    expect(result.passes).toHaveLength(2);
    expect(result.record.fallback_used).toBe(true);
    expect(result.verification.evidence_missing).toEqual([]);
    expect(deps.calls.map((c) => c.model)).toEqual([options.primaryModel, options.fallbackModel]);
    expect(result.cost_usd_micros).toBe(2000 + 3000 + 3000);
  });

  it("si el respaldo también falla, se sigue con los hallazgos y nunca hay tercera llamada", async () => {
    const f = await fixtures("nube_oct");
    const client = fakeClient([f.bad, f.bad, f.good]);
    const deps = readerDeps(client);
    const result = await readInvoice(deps, f.storage, f.doc, options);
    expect(client.requests).toHaveLength(2);
    expect(result.verification.evidence_missing).toEqual(["total"]);
    expect(result.record.fallback_used).toBe(false);
  });

  it("sin modelo de respaldo configurado no hay segunda pasada", async () => {
    const f = await fixtures("nube_oct");
    const client = fakeClient([f.bad, f.good]);
    const result = await readInvoice(readerDeps(client), f.storage, f.doc, {
      ...options,
      fallbackModel: null,
    });
    expect(client.requests).toHaveLength(1);
    expect(result.verification.evidence_missing).toEqual(["total"]);
  });

  it("no es factura no se repasa: ningún modelo la vuelve pagable", async () => {
    const f = await fixtures("nube_oct");
    const notInvoice = JSON.stringify({
      kind: "not_invoice",
      reason: "comprobante",
      suspicions: [],
    });
    const client = fakeClient([notInvoice, f.good]);
    const result = await readInvoice(readerDeps(client), f.storage, f.doc, options);
    expect(client.requests).toHaveLength(1);
    expect(result.record.extraction.kind).toBe("not_invoice");
  });

  it("si el respaldo dice que no es factura, gana esa lectura: solo endurece", async () => {
    const f = await fixtures("nube_oct");
    const notInvoice = JSON.stringify({
      kind: "not_invoice",
      reason: "comprobante",
      suspicions: [],
    });
    const client = fakeClient([f.bad, notInvoice]);
    const result = await readInvoice(readerDeps(client), f.storage, f.doc, options);
    expect(result.record.extraction.kind).toBe("not_invoice");
    expect(result.record.fallback_used).toBe(true);
  });

  it("una primera pasada ilegible se reemplaza por la lectura del respaldo", async () => {
    const f = await fixtures("nube_oct");
    const client = fakeClient(["{ roto", "{ roto", f.good]);
    const result = await readInvoice(readerDeps(client), f.storage, f.doc, options);
    expect(client.requests.map((r) => r.model)).toEqual([
      options.primaryModel,
      options.primaryModel,
      options.fallbackModel,
    ]);
    expect(result.record.extraction.kind).toBe("invoice");
  });

  it("si las dos pasadas leen distinto un campo crítico, la discrepancia queda como ambigüedad", async () => {
    const f = await fixtures("nube_oct");
    const other = JSON.parse(f.good);
    other.fields.bank_account.value = "31245679099";
    const client = fakeClient([f.bad, JSON.stringify(other)]);
    const result = await readInvoice(readerDeps(client), f.storage, f.doc, options);
    expect(result.verification.ambiguities).toContainEqual({
      field: "bank_account",
      candidates: ["31245679023", "31245679099"],
    });
  });

  it("el Detector suma sus señales al informe aunque el modelo no las vea", async () => {
    const f = await fixtures("inyeccion");
    const client = fakeClient([f.good]);
    const result = await readInvoice(readerDeps(client), f.storage, f.doc, {
      ...options,
      fallbackModel: null,
    });
    expect(result.verification.suspicions.map((s) => s.kind)).toContain("instruction_to_agent");
  });

  it("un documento escaneado va al modelo como imagen", async () => {
    const src = await loadDatasetSources();
    const c = src.manifest.cases.find((x) => x.id === "nube_sep_png");
    const t = c && src.templates.get(c.template);
    if (!c || !t) throw new Error("caso ausente");
    const storage = new MemoryFileStorage();
    const doc = await ingestDocument(
      {
        bytes: await generatedFile("nube_sep_png.png"),
        originalName: "s.png",
        storagePrefix: "org",
      },
      storage,
      limits,
    );
    const client = fakeClient([JSON.stringify(idealExtraction(c, t))]);
    const result = await readInvoice(readerDeps(client), storage, doc, {
      ...options,
      fallbackModel: null,
    });
    expect(client.requests[0]?.parts.some((p) => p.type === "image")).toBe(true);
    expect(result.record.extraction.kind).toBe("invoice");
  });
});
