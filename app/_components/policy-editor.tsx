"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { LockIcon } from "./icons";

/**
 * Editor de política (docs/interfaz.md §5.4), con el patrón de las páginas de configuración:
 * pestañas en vez de una página larga. "Política" es el formulario, "Como código" la misma
 * política en YAML para auditarla o editarla entera, "Versiones" el historial firmado, y
 * quien la usa puede sumar pestañas de solo lectura (las tasas de cambio). Las
 * claves protegidas van en una línea con candado y no se editan; las acciones quedan en una
 * barra fija abajo, siempre a la vista. Es la base de presentación: quien la usa decide si el
 * YAML es texto fijo o un editor sincronizado con el formulario.
 */

export type ProtectedKey = { readonly label: string; readonly value: string };

/** Una pestaña más de la política, después de las propias: versiones, tasas de cambio. */
export type PolicyTab = {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
};

export function PolicyEditor({
  version,
  signedBy,
  form,
  yaml,
  protectedKeys,
  actions = null,
  versions = null,
  extraTabs = [],
}: {
  readonly version: number;
  readonly signedBy: string;
  /** Campos del formulario. */
  readonly form: ReactNode;
  /** La parte editable de la política en YAML: texto de solo lectura, o el editor. */
  readonly yaml: string | ReactNode;
  readonly protectedKeys: readonly ProtectedKey[];
  readonly actions?: ReactNode;
  /** Historial de versiones, con cuántas hay. */
  readonly versions?: { readonly count: number; readonly content: ReactNode } | null;
  readonly extraTabs?: readonly PolicyTab[];
}) {
  const baseId = useId();
  const tabs: PolicyTab[] = [
    { id: "politica", label: "Política", content: form },
    {
      id: "codigo",
      label: "Como código",
      content:
        typeof yaml === "string" ? (
          <pre
            aria-label="Política en YAML"
            className="overflow-auto rounded-[var(--radius-card)] border border-line bg-surface-sunken p-4 font-mono text-[12px] leading-relaxed text-ink"
          >
            {yaml}
          </pre>
        ) : (
          yaml
        ),
    },
    ...(versions
      ? [
          {
            id: "versiones",
            label: `Versiones (${String(versions.count)})`,
            content: versions.content,
          },
        ]
      : []),
    ...extraTabs,
  ];
  // La pestaña elegida se guarda por su id: si cambian las pestañas, la selección no salta a
  // otra. Una pestaña que ya no existe vuelve a la primera.
  const [selectedId, setSelectedId] = useState("politica");
  const found = tabs.findIndex((tab) => tab.id === selectedId);
  const selected = found < 0 ? 0 : found;

  // Teclado del patrón de pestañas de ARIA: flechas recorren, Inicio y Fin saltan.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = tabs.length - 1;
    const targets: Readonly<Record<string, number>> = {
      ArrowRight: (selected + 1) % tabs.length,
      ArrowLeft: (selected + last) % tabs.length,
      Home: 0,
      End: last,
    };
    const next = targets[event.key] ?? null;
    if (next === null) return;
    event.preventDefault();
    setSelectedId(tabs[next]?.id ?? "politica");
    document.getElementById(`${baseId}-tab-${String(next)}`)?.focus();
  };

  return (
    <section aria-label={`Política v${String(version)}`} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
        <div role="tablist" aria-label="Vistas de la política" className="flex gap-1">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`${baseId}-tab-${String(index)}`}
              type="button"
              role="tab"
              aria-selected={index === selected}
              aria-controls={`${baseId}-panel-${String(index)}`}
              tabIndex={index === selected ? 0 : -1}
              onClick={() => setSelectedId(tab.id)}
              onKeyDown={onKeyDown}
              className={`-mb-px h-9 border-b-2 px-3 text-[13px] font-medium ${
                index === selected
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-2 hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="pb-2 text-[12px] text-ink-3">
          Vigente: v{version} · firmada por {signedBy}
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-3">
        {protectedKeys.map((key) => (
          <div key={key.label} className="inline-flex items-center gap-1.5">
            <LockIcon />
            <dt>{key.label}:</dt>
            <dd className="num text-ink-2">{key.value}</dd>
          </div>
        ))}
      </dl>

      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${String(index)}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${String(index)}`}
          hidden={index !== selected}
        >
          {tab.content}
        </div>
      ))}

      {actions ? (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 card px-4 py-3">
          {actions}
        </div>
      ) : null}
    </section>
  );
}
