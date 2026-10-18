import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DecisionPreview } from "@/app/_landing/decision-preview";
import {
  Control,
  DEMO_HREF,
  Faq,
  FinalCall,
  Hero,
  LandingNav,
  Proof,
  Verdicts,
} from "@/app/_landing/sections";

/**
 * P-144: la portada. Toda llamada a la acción lleva al producto (la única puerta que crea la
 * empresa de ejemplo), muestra las tres salidas y las cifras que recibe del código.
 */
describe("portada pública (P-144)", () => {
  const html = renderToStaticMarkup(
    <>
      <LandingNav />
      <Hero preview={<DecisionPreview />} />
      <Verdicts />
      <Control />
      <Proof ruleCount={21} sampleCount={33} />
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

  it("muestra las tres salidas y un ejemplo con regla, valor y umbral", () => {
    for (const verdict of ["Pagar", "Frenar", "Escalar"]) expect(html).toContain(verdict);
    expect(html).toContain("1,156.56 ≤ 5,000.00 USD");
  });

  it("marca lo que anima la portada; sin animación, el HTML ya es el estado final", () => {
    expect(html).toContain('data-intro="line"');
    expect(html).toContain("data-reveal-title");
    expect(html).toContain('data-count-to="21"');
    // El menú del teléfono empieza cerrado y anuncia su estado.
    expect(html).toContain('aria-expanded="false"');
  });

  it("las cifras vienen de quien la usa, no escritas en la sección", () => {
    expect(html).toContain(">21<");
    expect(html).toContain(">33<");
    expect(html).toContain("decidir 33 facturas");
  });
});
