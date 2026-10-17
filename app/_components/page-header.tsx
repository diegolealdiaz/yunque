import type { ReactNode } from "react";

/** Encabezado de pantalla: título, una línea de contexto a la derecha y acciones. */
export function PageHeader({
  title,
  meta = null,
  actions = null,
}: {
  readonly title: string;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-[26px] leading-tight font-bold tracking-tight text-ink sm:text-[30px]">
        {title}
      </h1>
      <div className="flex items-center gap-3 text-[13px] text-ink-2">
        {meta}
        {actions}
      </div>
    </header>
  );
}
