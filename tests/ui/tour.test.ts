import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/app/_components/sidebar";
import { TOUR_STEPS } from "@/src/ui/tour";

/**
 * P-147: el recorrido guiado. Cuatro pasos, cada uno en una sección de la barra y señalando
 * un elemento que esa pantalla de verdad tiene; empieza por "Probar el agente", que no
 * depende de que la empresa ya tenga facturas.
 */

/** Archivos que pintan cada pantalla del recorrido. */
const SOURCES: Readonly<Record<string, readonly string[]>> = {
  "/probar": ["app/(producto)/probar/page.tsx"],
  "/pendientes": ["app/(producto)/pendientes/page.tsx"],
  "/reglas": ["app/(producto)/reglas/policy-workbench.tsx"],
  "/bitacora": ["app/(producto)/bitacora/page.tsx"],
};

describe("recorrido guiado (P-147)", () => {
  it("cuatro pasos, el primero en Probar el agente, cada uno en una sección de la barra", () => {
    expect(TOUR_STEPS).toHaveLength(4);
    expect(TOUR_STEPS[0]?.route).toBe("/probar");
    const sections = new Set<string>(NAV_ITEMS.map((item) => item.href));
    for (const step of TOUR_STEPS) expect(sections.has(step.route), step.route).toBe(true);
  });

  it("cada paso señala un elemento que su pantalla tiene", async () => {
    for (const step of TOUR_STEPS) {
      const files = SOURCES[step.route] ?? [];
      const text = (
        await Promise.all(files.map((f) => readFile(path.join(process.cwd(), f), "utf8")))
      ).join("\n");
      expect(text, step.route).toContain(`data-tour="${step.anchor}"`);
    }
  });
});
