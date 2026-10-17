import type { ReactNode } from "react";

import { KeyboardShortcuts } from "../_components/shortcuts";
import { Sidebar, type ShellState } from "../_components/sidebar";

/**
 * Armazón de todas las pantallas del producto: barra lateral fija y contenido.
 *
 * El estado de la barra (contador, controles, salud) es de muestra hasta el paso 20, en
 * que la barra lee la empresa del visitante y su política vigente.
 */
const SAMPLE_STATE: ShellState = {
  organizationName: "Forja Labs Inc.",
  pendingCount: 3,
  controls: { payments_enabled: true, dry_run: false, autonomy: "decidir" },
  health: "ok",
};

export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh">
      <a
        href="#contenido"
        className="sr-only z-30 rounded-[var(--radius-control)] bg-ink px-3 py-2 text-surface focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>
      <Sidebar state={SAMPLE_STATE} />
      <main id="contenido" tabIndex={-1} className="flex-1 overflow-y-auto px-8 py-6 outline-none">
        {children}
      </main>
      <KeyboardShortcuts />
    </div>
  );
}
