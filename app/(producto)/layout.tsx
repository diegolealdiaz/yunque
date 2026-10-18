import type { ReactNode } from "react";

import { GuidedTour } from "../_components/guided-tour";
import { KeyboardShortcuts } from "../_components/shortcuts";
import { Sidebar } from "../_components/sidebar";
import { shellState } from "../_data/inbox";

/**
 * Armazón de todas las pantallas del producto: barra lateral fija y contenido. La barra lee
 * la empresa de quien pide, su política vigente y el contador de pendientes. Desde 1024 px la
 * barra va fija a la izquierda; por debajo, una barra superior la abre como menú. El
 * contenido se centra con un ancho máximo para que en pantallas grandes no quede pegado a la
 * izquierda.
 */
export default async function ProductLayout({ children }: { children: ReactNode }) {
  const state = await shellState();
  return (
    <div className="flex h-dvh flex-col lg:flex-row">
      <a
        href="#contenido"
        className="sr-only z-30 rounded-[var(--radius-control)] bg-ink px-3 py-2 text-surface focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>
      <Sidebar state={state} />
      <main
        id="contenido"
        tabIndex={-1}
        className="relative min-w-0 flex-1 overflow-y-auto px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-6"
      >
        <div className="mx-auto w-full max-w-[88rem] lg:h-full">{children}</div>
      </main>
      <KeyboardShortcuts />
      {state.demo ? <GuidedTour /> : null}
      <div aria-hidden="true" className="brand-frame" />
    </div>
  );
}
