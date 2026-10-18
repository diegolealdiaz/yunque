import type { Metadata } from "next";
import { connection } from "next/server";

import { loadBatchCases } from "@/src/dataset/demo-seed";
import { RULES } from "@/src/domain/rules";

import { loadSampleBatch } from "./_landing/cases";
import { LandingMotion } from "./_landing/motion";
import { Portal } from "./_landing/portal";
import { ProductFrame } from "./_landing/product-frame";
import {
  Announcement,
  Channels,
  Control,
  ControlPanel,
  Faq,
  FinalCall,
  Hero,
  LandingFooter,
  LandingNav,
  Proof,
  Section,
  Why,
} from "./_landing/sections";
import { HowItWorks, Problem } from "./_landing/story";
import { Ticker } from "./_landing/ticker";

export const metadata: Metadata = {
  title: "Yunque · Paga tus facturas sin salirte de tus reglas",
  description:
    "Agente de cuentas por pagar: lee cada factura, la revisa contra tu política y decide pagar, frenar o escalar a una persona, con la regla a la vista.",
};

/**
 * Portada pública (docs/interfaz.md §11). Presenta el producto como un relato y lleva a
 * probarlo: la promesa, el agente decidiendo, lo que decidió con el lote de ejemplo, el
 * problema, cómo funciona, el producto, el control y el cierre. No lee ni crea empresas: la
 * empresa de ejemplo nace al entrar al producto con "Probar la demo". Las cifras salen del
 * código y del manifiesto del dataset. El movimiento vive en `LandingMotion`; las secciones
 * solo lo marcan.
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
        <Portal />
        {batch ? <Ticker batch={batch} /> : null}
        <div className="space-y-32 py-32">
          <Problem />
          <Section
            id="como-funciona"
            eyebrow="Cómo funciona"
            title="De la factura a la decisión, en segundos."
            lead="Llegue por correo, por Telegram, en PDF o en foto, cada factura sigue el mismo camino. Tu equipo deja de revisar las que cumplen y dedica su tiempo a las que necesitan criterio."
          >
            <HowItWorks ruleCount={ruleCount} counts={batch?.counts ?? null} />
          </Section>
          <Section
            eyebrow="Dónde trabaja"
            title="Tu agente, en los canales que ya usas."
            lead="Sin portales nuevos para tus proveedores: la factura llega como hoy y el agente la toma de ahí."
          >
            <Channels />
          </Section>
          <ProductFrame />
          <Section eyebrow="Por qué Yunque" title="Automatizar pagos sin perder el control.">
            <Why />
          </Section>
        </div>
        <ControlPanel>
          <Control />
          <Proof ruleCount={ruleCount} sampleCount={sampleCount} />
        </ControlPanel>
        <div className="pt-32">
          <Section id="preguntas" eyebrow="Preguntas" title="Lo que suelen preguntar.">
            <Faq />
          </Section>
          {sampleCount > 0 ? <FinalCall sampleCount={sampleCount} /> : null}
        </div>
      </main>
      <LandingFooter />
    </LandingMotion>
  );
}
