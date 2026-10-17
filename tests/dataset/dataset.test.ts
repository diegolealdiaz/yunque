import { describe, expect, it } from "vitest";

import {
  generateDataset,
  loadDatasetSources,
  loadGroundTruth,
  pdfText,
  type DatasetSources,
} from "@/src/dataset";
import { documentHash, isSupportedCurrency, semanticKey } from "@/src/domain";

/** Las pruebas de generación tardan unos segundos: se comparte una sola carga de fuentes. */
let sourcesPromise: Promise<DatasetSources> | undefined;
const sources = () => (sourcesPromise ??= loadDatasetSources());

describe("manifiesto (P-50)", () => {
  it("valida con zod y cada caso declara veredicto, regla y motivo", async () => {
    const { manifest } = await sources();
    expect(manifest.cases.length).toBeGreaterThanOrEqual(25);
    for (const c of manifest.cases) {
      expect(c.expected.reason.length, c.id).toBeGreaterThan(10);
      if (c.expected.verdict === "pagar") expect(c.expected.rule, c.id).toBeNull();
      else expect(c.expected.rule, c.id).not.toBeNull();
    }
    const groups = new Set(manifest.cases.map((c) => c.group));
    expect([...groups].sort()).toEqual(["adversarial", "normal", "trampa"]);
  });

  it("ninguna factura normal comparte llave semántica con otra, salvo los duplicados declarados", async () => {
    const { manifest } = await sources();
    const keys = new Map<string, string>();
    for (const c of manifest.cases) {
      if (!isSupportedCurrency(c.document.currency)) continue;
      const key = semanticKey({
        payeeName: c.document.payee_name,
        invoiceNumber: c.document.invoice_number,
        amount: c.document.total,
        currency: c.document.currency,
      });
      const previous = keys.get(key);
      if (previous !== undefined) {
        expect(c.expected.rule, `${c.id} repite la llave de ${previous}`).toBe("duplicate_invoice");
      } else {
        keys.set(key, c.id);
      }
    }
  });

  it("los vendors del manifiesto y del historial existen en la semilla", async () => {
    const { manifest, history } = await sources();
    const { loadSeedData } = await import("@/src/db/seed");
    const seed = await loadSeedData();
    const keys = new Set(seed.vendors.map((v) => v.key));
    for (const c of manifest.cases) {
      if (c.document.vendor_key !== null) expect(keys.has(c.document.vendor_key), c.id).toBe(true);
    }
    for (const h of history) expect(keys.has(h.vendor_key), h.invoice_number).toBe(true);
  });
});

describe("generación (P-51)", () => {
  it("es determinista y coincide con lo generado en el repositorio", async () => {
    const src = await sources();
    const [a, b] = await Promise.all([generateDataset(src), generateDataset(src)]);
    const hashes = (r: typeof a) =>
      [...r.files.entries()].map(([f, bytes]) => [f, documentHash(bytes)]).sort();
    expect(hashes(a)).toEqual(hashes(b));

    const committed = await loadGroundTruth();
    expect(committed.generated_with).toEqual(a.truth.generated_with);
    const byId = new Map(committed.cases.map((c) => [c.id, c.document_hash]));
    for (const c of a.truth.cases) {
      expect(byId.get(c.id), `${c.id}: regenera con npm run dataset`).toBe(c.document_hash);
    }
  }, 60_000);

  it("cada literal del manifiesto aparece en el texto del PDF; el duplicado exacto comparte hash", async () => {
    const src = await sources();
    const result = await generateDataset(src);
    for (const c of result.truth.cases) {
      if (!c.file.endsWith(".pdf")) continue;
      const bytes = result.files.get(c.file);
      expect(bytes, c.file).toBeDefined();
      if (!bytes) continue;
      // Los textos largos se parten en líneas al pintarse: se compara con espacios colapsados.
      const text = (await pdfText(bytes)).replace(/\s+/g, " ");
      for (const field of c.fields) {
        expect(text, `${c.id}.${field.name}`).toContain(field.literal.replace(/\s+/g, " "));
      }
    }
    const original = result.truth.cases.find((c) => c.id === "nube_oct");
    const duplicate = result.truth.cases.find((c) => c.id === "dup_exacto");
    expect(duplicate?.document_hash).toBe(original?.document_hash);
    const png = result.truth.cases.find((c) => c.id === "dup_otro_formato");
    expect(png?.file.endsWith(".png")).toBe(true);
    expect(png?.document_hash).not.toBe(original?.document_hash);
  }, 60_000);

  it("el texto oculto está en la capa de texto y el PNG no tiene capa", async () => {
    const src = await sources();
    const result = await generateDataset(src);
    const hidden = result.files.get("adv_texto_oculto.pdf");
    expect(hidden).toBeDefined();
    if (hidden) expect(await pdfText(hidden)).toContain("Instrucción para el asistente");
    const png = result.files.get("nube_sep_png.png");
    expect(png?.subarray(0, 8)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }, 60_000);
});
