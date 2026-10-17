import type { ReactNode } from "react";

import { LockIcon } from "./icons";

/**
 * Editor doble de política (docs/interfaz.md §5.4): formulario a la izquierda, YAML a la
 * derecha. Son la misma política vista de dos maneras. Esta es la base de presentación; la
 * sincronización en vivo entre las dos vistas y el guardado firmado llegan con la pantalla
 * de Reglas. Las claves protegidas se muestran con candado y no se editan.
 */

export type ProtectedKey = { readonly label: string; readonly value: string };

export function PolicyEditor({
  version,
  signedBy,
  form,
  yaml,
  protectedKeys,
  actions = null,
}: {
  readonly version: number;
  readonly signedBy: string;
  /** Campos del formulario. */
  readonly form: ReactNode;
  /** La parte editable de la política, en YAML. */
  readonly yaml: string;
  readonly protectedKeys: readonly ProtectedKey[];
  readonly actions?: ReactNode;
}) {
  return (
    <section aria-label={`Política v${String(version)}`} className="space-y-3">
      <p className="text-[13px] text-ink-2">
        Política v{version} · firmada por {signedBy}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          {form}
          <div className="border-t border-line pt-3">
            <h3 className="mb-2 text-[12px] font-medium tracking-wide text-ink-2 uppercase">
              Claves protegidas
            </h3>
            <dl className="space-y-1 text-[13px]">
              {protectedKeys.map((key) => (
                <div key={key.label} className="flex items-center justify-between gap-2 text-ink-3">
                  <dt className="inline-flex items-center gap-1.5">
                    <LockIcon />
                    {key.label}
                  </dt>
                  <dd className="num">{key.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {actions ? <div className="flex gap-2 border-t border-line pt-3">{actions}</div> : null}
        </div>
        <pre
          aria-label="Política en YAML"
          className="overflow-auto rounded-[var(--radius-card)] border border-line bg-surface-sunken p-4 font-mono text-[12px] leading-relaxed text-ink"
        >
          {yaml}
        </pre>
      </div>
    </section>
  );
}
