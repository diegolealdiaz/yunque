import Link from "next/link";
import type { ReactNode } from "react";

import { GuidedTour } from "../_components/guided-tour";
import { KeyboardShortcuts } from "../_components/shortcuts";
import { Sidebar } from "../_components/sidebar";
import { DemoFullError } from "../_data/context";
import { shellState } from "../_data/inbox";

/**
 * Armazón de todas las pantallas del producto: barra lateral fija y contenido. La barra lee
 * la empresa de quien pide, su política vigente y el contador de pendientes. Desde 1024 px la
 * barra va fija a la izquierda; por debajo, una barra superior la abre como menú. El
 * contenido se centra con un ancho máximo para que en pantallas grandes no quede pegado a la
 * izquierda.
 */
export default async function ProductLayout({ children }: { children: ReactNode }) {
  const state = await shellState().catch((error: unknown) => {
    if (error instanceof DemoFullError) return null;
    throw error;
  });
  if (state === null) return <DemoFull />;
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

/** Visitante nuevo con el tope de empresas de ejemplo del día ya alcanzado. */
function DemoFull() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-[20px] font-semibold text-ink">La demo está llena por hoy</h1>
        <p className="text-[14px] text-ink-2">
          Cada visitante recibe su propia empresa de ejemplo, y hoy ya se crearon todas las que
          permite la demo. Vuelve mañana y tendrás la tuya.
        </p>
        <Link href="/" className="inline-block text-[14px] font-medium text-brand hover:underline">
          Volver a la portada
        </Link>
      </div>
    </main>
  );
}
