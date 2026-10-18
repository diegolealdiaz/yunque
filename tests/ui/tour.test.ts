import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/app/_components/sidebar";
import { TOUR_INVOICE_ROUTE, TOUR_STEPS } from "@/src/ui/tour";

/**
 * P-147: el recorrido guiado. Nueve pasos: empieza con una bienvenida centrada que da los tres
 * veredictos, sigue por pantallas de la barra y por el detalle de una factura, y termina con
 * acciones. Cada paso que señala algo lo señala en un elemento que su pantalla de verdad tiene.
 */

/** Archivos que pintan cada pantalla del recorrido. */
const SOURCES: Readonly<Record<string, readonly string[]>> = {
  "/probar": ["app/(producto)/probar/page.tsx"],
  "/pendientes": ["app/(producto)/pendientes/page.tsx"],
  [TOUR_INVOICE_ROUTE]: [
    "app/(producto)/facturas/[id]/page.tsx",
    "app/(producto)/facturas/[id]/why-card.tsx",
  ],
  "/reglas": ["app/(producto)/reglas/policy-workbench.tsx"],
  "/metricas": ["app/(producto)/metricas/page.tsx"],
  "/bitacora": ["app/(producto)/bitacora/page.tsx"],
};

describe("recorrido guiado (P-147)", () => {
  it("nueve pasos: bienvenida centrada primero, acciones al final, rutas de la barra o el detalle", () => {
    expect(TOUR_STEPS).toHaveLength(9);
    expect(TOUR_STEPS[0]).toMatchObject({ route: "/probar", anchor: null, extra: "veredictos" });
    expect(TOUR_STEPS.at(-1)?.extra).toBe("acciones");
    const sections = new Set<string>([...NAV_ITEMS.map((item) => item.href), TOUR_INVOICE_ROUTE]);
    for (const step of TOUR_STEPS) expect(sections.has(step.route), step.route).toBe(true);
  });

  it("cada paso que señala algo lo encuentra en su pantalla", async () => {
    for (const step of TOUR_STEPS) {
      if (step.anchor === null) continue;
      const files = SOURCES[step.route] ?? [];
      const text = (
        await Promise.all(files.map((f) => readFile(path.join(process.cwd(), f), "utf8")))
      ).join("\n");
      expect(text, step.route).toMatch(
        new RegExp(`data-tour="${step.anchor}"|tour="${step.anchor}"`),
      );
    }
  });

  it("textos breves: ningún paso pasa de dos o tres frases", () => {
    for (const step of TOUR_STEPS) {
      expect(step.body.length, step.title).toBeLessThan(330);
      expect(step.title.length, step.title).toBeLessThan(60);
    }
  });
});
