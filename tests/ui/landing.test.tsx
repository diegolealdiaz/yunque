import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { loadSampleBatch } from "@/app/_landing/cases";
import { Portal } from "@/app/_landing/portal";
import {
  Announcement,
  Channels,
  Control,
  ControlPanel,
  DEMO_HREF,
  Faq,
  FinalCall,
  Hero,
  LandingNav,
  Proof,
  Why,
} from "@/app/_landing/sections";
import { HowItWorks, Problem } from "@/app/_landing/story";
import { Ticker } from "@/app/_landing/ticker";
import { loadExpectedCases } from "@/src/dataset/demo-seed";

/**
 * P-144: la portada. Toda llamada a la acción lleva al producto (la única puerta que crea la
 * empresa de ejemplo), lo que muestra del lote coincide con el manifiesto y las cifras salen
 * del código.
 */
describe("portada pública (P-144)", async () => {
  const batch = await loadSampleBatch();
  const counts = batch?.counts ?? null;
  const html = renderToStaticMarkup(
    <>
      <Announcement sampleCount={33} />
      <LandingNav />
      <Hero />
      <Portal />
      {batch ? <Ticker batch={batch} /> : null}
      <Problem />
      <HowItWorks ruleCount={21} counts={counts} />
      <Channels />
      <Why />
      <ControlPanel>
        <Control />
        <Proof ruleCount={21} sampleCount={33} />
      </ControlPanel>
      <Faq />
      <FinalCall sampleCount={33} />
    </>,
  );

  it("cada «Probar la demo» lleva al producto", () => {
    const ctas = html.match(/<a[^>]*>Probar la demo/g) ?? [];
    // Barra, primer bloque, menú del teléfono, «por qué» y cierre.
    expect(ctas).toHaveLength(5);
    for (const cta of ctas) expect(cta).toContain(`href="${DEMO_HREF}"`);
    expect(DEMO_HREF).toBe("/pendientes");
  });

  it("el agente de la portada decide como el motor decide esos casos del lote", async () => {
    const cases = await loadExpectedCases();
    const verdictOf = (id: string) => cases.find((c) => c.id === id)?.expected.verdict;
    // Nube Andina F-2291 se paga, Camila Rojas CR-121 se frena, Andes Hardware AH-5560 escala.
    expect(verdictOf("nube_oct")).toBe("pagar");
    expect(verdictOf("inyeccion")).toBe("frenar");
    expect(verdictOf("sobre_umbral")).toBe("escalar");
    expect(verdictOf("cuenta_distinta")).toBe("frenar");
    for (const text of ["F-2291", "CR-121", "AH-5560", "1,156.56 ≤ 5,000.00 USD"]) {
      expect(html).toContain(text);
    }
  });

  it("la cinta muestra cada caso del lote con su veredicto y los totales por salida", () => {
    expect(batch?.decisions).toHaveLength(33);
    expect(counts).toEqual({ pagar: 15, frenar: 10, escalar: 8 });
    expect(html).toContain("15 pagadas");
    expect(html).toContain("10 frenadas");
    expect(html).toContain("8 para una persona");
  });

  it("marca lo que anima la portada; sin animación, el HTML ya es el estado final", () => {
    expect(html).toContain('data-intro="line"');
    expect(html).toContain("data-portal-ring");
    expect(html).toContain("data-story-step");
    expect(html).toContain("data-reveal-title");
    expect(html).toContain('data-count-to="21"');
    // El menú del teléfono empieza cerrado y anuncia su estado.
    expect(html).toContain('aria-expanded="false"');
  });

  it("las cifras vienen de quien la usa, no escritas en la sección", () => {
    expect(html).toContain(">21<");
    expect(html).toContain(">33<");
    expect(html).toContain("decidir las 33 facturas");
  });
});
