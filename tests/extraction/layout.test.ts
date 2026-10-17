import { describe, expect, it } from "vitest";

import { loadDatasetSources, loadGroundTruth } from "@/src/dataset";
import {
  MemoryFileStorage,
  PageLayoutSchema,
  ingestDocument,
  locateEvidence,
  locateQuote,
  type PageLayout,
} from "@/src/extraction";

import { generatedFile } from "./helpers";

/**
 * Posiciones del texto (D11): la ingesta guarda la caja de cada carácter y `locateQuote`
 * encuentra dónde está una cita. Se contrasta con las coordenadas que el generador del
 * dataset registró al pintar cada campo.
 */

const limits = { maxUploadBytes: 5 * 1024 * 1024, maxPages: 5 };

async function layoutOf(file: string): Promise<PageLayout | null> {
  const storage = new MemoryFileStorage();
  const doc = await ingestDocument(
    { bytes: await generatedFile(file), originalName: file, storagePrefix: "org" },
    storage,
    limits,
  );
  const key = doc.pages[0]?.layoutKey;
  if (!key) return null;
  return PageLayoutSchema.parse(JSON.parse(new TextDecoder().decode(await storage.get(key))));
}

describe("posiciones de las citas", () => {
  it("en cada PDF del dataset, el total y la cuenta caen dentro de la casilla que pintó el generador", async () => {
    const [truth, src] = await Promise.all([loadGroundTruth(), loadDatasetSources()]);
    const pdfs = truth.cases.filter((c) => c.format === "pdf");
    expect(pdfs.length).toBeGreaterThan(20);
    for (const c of pdfs) {
      const template = src.templates.get(
        src.manifest.cases.find((m) => m.id === c.id)?.template ?? "factura_co",
      );
      if (!template) throw new Error(`plantilla de ${c.id}`);
      const layout = await layoutOf(c.file);
      expect(layout, c.id).not.toBeNull();
      if (!layout) continue;
      for (const name of ["total", "bank_account"] as const) {
        const field = c.fields.find((f) => f.name === name);
        if (!field || field.literal === "") continue;
        // La cita que daría el Lector: la etiqueta que pinta la plantilla más el valor.
        const prefix = template.fields.find((f) => f.name === name)?.prefix ?? "";
        const box = locateEvidence(layout, `${prefix}${field.literal}`, field.literal);
        expect(box, `${c.id}.${name}`).not.toBeNull();
        if (!box) continue;
        // Casilla del generador en fracciones de la página de su plantilla, con un milímetro
        // de holgura por el interlineado de la fuente.
        const { width, height } = template.page;
        const slack = 1;
        expect(box.x, `${c.id}.${name} x`).toBeGreaterThanOrEqual((field.x - slack) / width);
        expect(box.y, `${c.id}.${name} y`).toBeGreaterThanOrEqual((field.y - slack) / height);
        expect(box.x + box.w, `${c.id}.${name} ancho`).toBeLessThanOrEqual(
          (field.x + field.width + slack) / width,
        );
        expect(box.y + box.h, `${c.id}.${name} alto`).toBeLessThanOrEqual(
          (field.y + field.height + slack) / height,
        );
      }
    }
  }, 120_000);

  it("un valor repetido se ubica dentro de su cita, no en la primera aparición", () => {
    const text = "Subtotal: 100,00\nTOTAL: 100,00";
    const layout: PageLayout = {
      text,
      boxes: Array.from(text).flatMap((ch, i) =>
        /\s/.test(ch) ? [0, 0, 0, 0] : [0.1, i * 0.01, 0.2, i * 0.01 + 0.009],
      ),
    };
    const total = locateEvidence(layout, "TOTAL: 100,00", "100,00");
    const first = locateQuote(layout, "100,00");
    expect(total && first && total.y > first.y).toBe(true);
  });

  it("un escaneo sin capa de texto no tiene posiciones", async () => {
    expect(await layoutOf("nube_sep_png.png")).toBeNull();
  });

  it("la búsqueda ignora espacios y saltos de línea, y luego mayúsculas", () => {
    const layout: PageLayout = {
      text: "Total:\r\n  4.800.000,00",
      boxes: Array.from("Total:\r\n  4.800.000,00").flatMap((ch, i) =>
        /\s/.test(ch) ? [0, 0, 0, 0] : [i * 0.01, 0.5, i * 0.01 + 0.009, 0.52],
      ),
    };
    const box = locateQuote(layout, "Total: 4.800.000,00");
    expect(box?.x).toBe(0);
    expect(box?.y).toBe(0.5);
    expect(box && box.x + box.w).toBeCloseTo(0.219, 3);
    expect(locateQuote(layout, "TOTAL:")).not.toBeNull();
    expect(locateQuote(layout, "9.999")).toBeNull();
    expect(locateQuote(layout, "   ")).toBeNull();
  });
});
