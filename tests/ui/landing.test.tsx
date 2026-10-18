import { existsSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { loadSampleBatch } from "@/app/_landing/cases";
import {
  Announcement,
  Channels,
  ControlPanel,
  DEMO_HREF,
  Faq,
  FinalCall,
  Guarantees,
  Hero,
  HeroShot,
  LandingNav,
  Numbers,
  Steps,
} from "@/app/_landing/sections";
import { ProductShowcase } from "@/app/_landing/showcase";
import { Ticker } from "@/app/_landing/ticker";

/**
 * P-144: la portada. Toda llamada a la acción lleva al producto (la única puerta que crea la
 * empresa de ejemplo), lo que muestra del lote coincide con el manifiesto, las cifras salen
 * del código y las capturas del producto existen.
 */
describe("portada pública (P-144)", async () => {
  const batch = await loadSampleBatch();
  const counts = batch?.counts ?? null;
  const html = renderToStaticMarkup(
    <>
      <Announcement sampleCount={33} />
      <LandingNav />
      <Hero />
      <HeroShot />
      {batch ? <Ticker batch={batch} /> : null}
      <Numbers ruleCount={21} />
      <Steps />
      <ProductShowcase />
      <ControlPanel>
        <Guarantees />
      </ControlPanel>
      <Channels />
      <Faq />
      <FinalCall sampleCount={33} />
    </>,
  );

  it("cada «Probar la demo» lleva al producto", () => {
    const ctas = html.match(/<a[^>]*>Probar la demo/g) ?? [];
    // Barra, primer bloque, menú del teléfono y cierre.
    expect(ctas).toHaveLength(4);
    for (const cta of ctas) expect(cta).toContain(`href="${DEMO_HREF}"`);
    expect(DEMO_HREF).toBe("/pendientes");
  });

  it("la cinta muestra cada caso del lote con su veredicto y los totales por salida", () => {
    expect(batch?.decisions).toHaveLength(33);
    expect(counts).toEqual({ pagar: 15, frenar: 10, escalar: 8 });
    expect(html).toContain("15 pagadas");
    expect(html).toContain("10 frenadas");
    expect(html).toContain("8 para una persona");
  });

  it("muestra el producto real: cada captura que usa existe en public/producto", () => {
    const shots = [...html.matchAll(/producto%2F([a-z-]+)\.webp|\/producto\/([a-z-]+)\.webp/g)].map(
      (m) => m[1] ?? m[2],
    );
    expect(new Set(shots).size).toBeGreaterThanOrEqual(2);
    for (const name of ["pendientes", "por-que", "decision", "reglas", "metricas", "bitacora"]) {
      expect(existsSync(path.join(process.cwd(), "public/producto", `${name}.webp`)), name).toBe(
        true,
      );
    }
    // Las pestañas del producto son accesibles: una lista con la primera seleccionada.
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
  });

  it("marca lo que anima la portada; sin animación, el HTML ya es el estado final", () => {
    expect(html).toContain('data-intro="line"');
    expect(html).toContain('data-intro="frame"');
    expect(html).toContain("data-reveal-title");
    // El menú del teléfono empieza cerrado y anuncia su estado.
    expect(html).toContain('aria-expanded="false"');
  });

  it("las cifras vienen de quien la usa, y la seguridad nombra lo que el producto hace", () => {
    expect(html).toContain(">21<");
    expect(html).toContain("decidir las 33 facturas");
    for (const text of ["Doble firma", "Proveedores verificados", "Todo queda escrito"]) {
      expect(html).toContain(text);
    }
  });
});
