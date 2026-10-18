import type { ReactNode } from "react";

/**
 * Encabezado de pantalla: título con una línea de contexto debajo, y a la derecha lo que
 * acompaña (`meta`) y las acciones.
 */
export function PageHeader({
  title,
  subtitle = null,
  meta = null,
  actions = null,
}: {
  readonly title: string;
  /** Una línea bajo el título: cuántas hay, de qué se trata. */
  readonly subtitle?: ReactNode;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight text-ink sm:text-[30px]">
          {title}
        </h1>
        {subtitle ? <p className="text-[13px] text-ink-3">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-ink-2">
        {meta}
        {actions}
      </div>
    </header>
  );
}
