import type { ReactNode } from "react";

import { KeyboardShortcuts } from "../_components/shortcuts";
import { Sidebar } from "../_components/sidebar";
import { shellState } from "../_data/inbox";

/**
 * Armazón de todas las pantallas del producto: barra lateral fija y contenido. La barra lee
 * la empresa de quien pide, su política vigente y el contador de pendientes.
 */
export default async function ProductLayout({ children }: { children: ReactNode }) {
  const state = await shellState();
  return (
    <div className="flex h-dvh">
      <a
        href="#contenido"
        className="sr-only z-30 rounded-[var(--radius-control)] bg-ink px-3 py-2 text-surface focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>
      <Sidebar state={state} />
      <main id="contenido" tabIndex={-1} className="flex-1 overflow-y-auto px-8 py-6 outline-none">
        {children}
      </main>
      <KeyboardShortcuts />
    </div>
  );
}
