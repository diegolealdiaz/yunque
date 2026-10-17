import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Estados de una lista o pantalla (docs/interfaz.md §8):
 * - vacío: una frase que confirma lo que pasó y un enlace para verlo;
 * - carga: esqueleto de la tabla, no una rueda;
 * - error: causa y salida, con reintento si aplica.
 */

export function EmptyState({
  title,
  detail = null,
  action = null,
}: {
  readonly title: string;
  readonly detail?: string | null;
  readonly action?: { readonly label: string; readonly href: string } | null;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {detail ? <p className="mt-1 text-[13px] text-ink-2">{detail}</p> : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-3 inline-block text-[13px] font-medium text-ink underline underline-offset-4"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title,
  cause,
  action,
  retry = null,
}: {
  readonly title: string;
  /** Qué pasó, en una frase. */
  readonly cause: string;
  /** Qué puede hacer la persona. */
  readonly action: string;
  readonly retry?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-card)] border border-hold-solid/40 bg-hold-tint px-5 py-4"
    >
      <p className="text-[14px] font-medium text-hold">{title}</p>
      <p className="mt-1 text-[13px] text-ink">{cause}</p>
      <p className="mt-1 text-[13px] text-ink-2">{action}</p>
      {retry ? <div className="mt-3">{retry}</div> : null}
    </div>
  );
}

export function TableSkeleton({
  rows = 5,
  columns = 5,
}: {
  readonly rows?: number;
  readonly columns?: number;
}) {
  return (
    <div aria-busy="true" aria-label="Cargando" className="overflow-hidden card">
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="flex h-[var(--row-height)] items-center gap-4 border-b border-line px-3 last:border-b-0"
        >
          {Array.from({ length: columns }, (_, c) => (
            <span key={c} className="skeleton h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Tarjeta en carga: título y unas líneas, con la forma de la tarjeta que viene. */
export function CardSkeleton({
  lines = 3,
  className = "",
}: {
  readonly lines?: number;
  readonly className?: string;
}) {
  return (
    <div aria-hidden="true" className={`card space-y-3 p-5 ${className}`}>
      <span className="skeleton block h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={`skeleton block h-3 ${i % 2 === 0 ? "w-full" : "w-4/5"}`} />
      ))}
    </div>
  );
}
