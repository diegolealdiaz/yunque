import type { Verdict } from "@/src/domain";

import type { SampleBatch, SampleDecision } from "./cases";

/**
 * Cinta con las decisiones del lote de ejemplo, de punta a punta de la pantalla, justo
 * debajo del primer bloque: la prueba en movimiento de lo que el titular promete. Cada caso
 * con su veredicto y su motivo, tal como los exige la prueba del dataset. La cinta se mueve
 * con CSS y se detiene bajo el puntero; con "reducir movimiento" queda quieta y se desplaza
 * a mano.
 */

const WORD: Readonly<Record<Verdict, { readonly label: string; readonly className: string }>> = {
  pagar: { label: "PAGADA", className: "text-pay" },
  frenar: { label: "FRENADA", className: "text-hold" },
  escalar: { label: "ESCALADA", className: "text-escalate" },
};

const DOT: Readonly<Record<Verdict, string>> = {
  pagar: "bg-pay-solid",
  frenar: "bg-hold-solid",
  escalar: "bg-escalate-solid",
};

function Item({ decision }: { readonly decision: SampleDecision }) {
  const word = WORD[decision.verdict];
  return (
    <li className="flex shrink-0 items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 text-[13px]">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[decision.verdict]}`} />
      <span className="font-medium text-ink">{decision.payee}</span>
      <span className="font-mono text-[12px] text-ink-3">{decision.reference}</span>
      <span className={`font-mono text-[12px] font-semibold ${word.className}`}>{word.label}</span>
      <span className="text-ink-2">{decision.reason}</span>
    </li>
  );
}

export function Ticker({ batch }: { readonly batch: SampleBatch }) {
  const { counts } = batch;
  return (
    <section
      aria-labelledby="cinta-titulo"
      className="relative left-1/2 -ml-[50vw] w-screen border-y border-line bg-shell/60 py-6"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 sm:px-6">
        <h2 id="cinta-titulo" className="caps">
          Lo que decidió el agente con el lote de ejemplo
        </h2>
        <p className="font-mono text-[12px] text-ink-3">
          <span className="text-pay">{counts.pagar} pagadas</span> ·{" "}
          <span className="text-hold">{counts.frenar} frenadas</span> ·{" "}
          <span className="text-escalate">{counts.escalar} para una persona</span>
        </p>
      </div>
      <div className="ticker-mask mt-4 overflow-x-auto [scrollbar-width:none] motion-safe:overflow-hidden">
        <div className="ticker-track flex w-max gap-3">
          <ul className="flex gap-3">
            {batch.decisions.map((decision) => (
              <Item key={decision.id} decision={decision} />
            ))}
          </ul>
          {/* Segunda copia para que la cinta no tenga costura; los lectores de pantalla la saltan. */}
          <ul aria-hidden="true" className="flex gap-3 motion-reduce:hidden">
            {batch.decisions.map((decision) => (
              <Item key={decision.id} decision={decision} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
