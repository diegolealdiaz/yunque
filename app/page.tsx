import type { Metadata } from "next";
import { connection } from "next/server";

import { loadBatchCases } from "@/src/dataset/demo-seed";
import { RULES } from "@/src/domain/rules";

import { loadSampleBatch } from "./_landing/cases";
import { LandingMotion } from "./_landing/motion";
import {
  Announcement,
  Channels,
  ControlPanel,
  Faq,
  FinalCall,
  Guarantees,
  Hero,
  HeroShot,
  LandingFooter,
  LandingNav,
  Numbers,
  Section,
  Steps,
} from "./_landing/sections";
import { ProductShowcase } from "./_landing/showcase";
import { Ticker } from "./_landing/ticker";

export const metadata: Metadata = {
  title: "Yunque · Paga tus facturas sin salirte de tus reglas",
  description:
    "Agente de cuentas por pagar: lee cada factura, la revisa contra tu política y decide pagar, frenar o escalar a una persona, con la regla a la vista.",
};

/**
 * Portada pública (docs/interfaz.md §11). Corta y con el producto de verdad: la promesa con
 * una captura real, lo que decidió el lote de ejemplo, las cifras medidas, cómo funciona en
 * tres pasos, el producto en capturas, la seguridad, los canales y el cierre. No lee ni crea
 * empresas: la empresa de ejemplo nace al entrar al producto con "Probar la demo". Las cifras
 * salen del código y del manifiesto del dataset. El movimiento vive en `LandingMotion`; las
 * secciones solo lo marcan.
 */
export default async function Home() {
  // Por petición, no prerenderizada: la política de seguridad exige el nonce de cada respuesta
  // en los scripts, y una página estática no lo tendría.
  await connection();
  const ruleCount = Object.keys(RULES).length;
  const batch = await loadSampleBatch();
  const sampleCount = await loadBatchCases()
    .then((cases) => cases.length)
    .catch(() => 0);

  return (
    <LandingMotion>
      <Announcement sampleCount={sampleCount} />
      <LandingNav />
      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <Hero />
        <HeroShot />
        {batch ? <Ticker batch={batch} /> : null}
        <div className="space-y-28 py-24">
          <Numbers ruleCount={ruleCount} />
          <Section
            id="como-funciona"
            eyebrow="Cómo funciona"
            title="De la factura a la decisión, en segundos."
            lead="Tu equipo deja de revisar las facturas que cumplen y dedica su tiempo a las que necesitan criterio."
          >
            <Steps />
          </Section>
          <Section
            id="producto"
            eyebrow="El producto"
            title="Así se ve por dentro."
            lead="Capturas reales de la demo, con las 33 facturas de ejemplo ya decididas."
          >
            <ProductShowcase />
          </Section>
        </div>
        <ControlPanel>
          <Guarantees />
        </ControlPanel>
        <div className="space-y-28 pt-28">
          <Section
            eyebrow="Dónde trabaja"
            title="En los canales que ya usas."
            lead="La factura llega como hoy y el agente la toma de ahí."
          >
            <Channels />
          </Section>
          <Section id="preguntas" eyebrow="Preguntas" title="Lo que suelen preguntar.">
            <Faq />
          </Section>
        </div>
        {sampleCount > 0 ? <FinalCall sampleCount={sampleCount} /> : null}
      </main>
      <LandingFooter />
    </LandingMotion>
  );
}
