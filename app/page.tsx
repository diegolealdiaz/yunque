import type { Metadata } from "next";
import { connection } from "next/server";

import { loadBatchCases } from "@/src/dataset/demo-seed";
import { RULES } from "@/src/domain/rules";

import { DecisionPreview } from "./_landing/decision-preview";
import { LandingMotion } from "./_landing/motion";
import { ProductFrame } from "./_landing/product-frame";
import {
  Control,
  Faq,
  FinalCall,
  Hero,
  HowItWorks,
  LandingFooter,
  LandingNav,
  Proof,
  Section,
  Verdicts,
} from "./_landing/sections";

export const metadata: Metadata = {
  title: "Yunque · Paga tus facturas sin salirte de tus reglas",
  description:
    "Agente de cuentas por pagar: lee cada factura, la revisa contra tu política y decide pagar, frenar o escalar a una persona, con la regla a la vista.",
};

/**
 * Portada pública (docs/interfaz.md §11). Presenta el producto y lleva a probarlo. No lee
 * ni crea empresas: la empresa de ejemplo nace al entrar al producto con "Probar la demo".
 * Las cifras salen del código: cuántos controles tiene el motor y cuántos casos el lote.
 * El movimiento (entrada, revelaciones, producto que crece, pop de botones) vive en
 * `LandingMotion`; las secciones solo lo marcan.
 */
export default async function Home() {
  // Por petición, no prerenderizada: la política de seguridad exige el nonce de cada respuesta
  // en los scripts, y una página estática no lo tendría.
  await connection();
  const ruleCount = Object.keys(RULES).length;
  const sampleCount = await loadBatchCases()
    .then((cases) => cases.length)
    .catch(() => 0);

  return (
    <LandingMotion>
      <LandingNav />
      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <Hero preview={<DecisionPreview />} />
        <div className="space-y-28 pb-24">
          <ProductFrame />
          <Section
            eyebrow="Tres salidas, nunca otra"
            title="Cada factura termina en pagar, frenar o escalar."
            lead="El color siempre significa lo mismo, en la pantalla, en el aviso y en la bitácora."
          >
            <Verdicts />
          </Section>
          <Section
            id="como-funciona"
            eyebrow="Cómo funciona"
            title="Del correo a la decisión, en segundos."
            lead="Tu equipo deja de revisar las facturas que cumplen y dedica su tiempo a las que de verdad necesitan criterio."
          >
            <HowItWorks ruleCount={ruleCount} />
          </Section>
          <Section
            id="control"
            eyebrow="Control"
            title="Automatizar pagos sin perder el control."
            lead="El agente trabaja dentro de un mandato que tú firmas. Cada decisión se explica, se audita y, si hace falta, la revisa una persona antes de que el dinero se mueva."
          >
            <Control />
          </Section>
          <Section eyebrow="Con datos, no con promesas" title="Medido en cada cambio.">
            <Proof ruleCount={ruleCount} sampleCount={sampleCount} />
          </Section>
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
