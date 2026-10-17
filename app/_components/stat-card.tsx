import Link from "next/link";

/**
 * Tarjeta numérica de Métricas. Cada número enlaza a las facturas que lo componen
 * (docs/interfaz.md §5.5): un número sin origen no se puede defender.
 */
export function StatCard({
  label,
  value,
  detail = null,
  href = null,
  emphasis = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | null;
  /** A dónde lleva el número: la lista de facturas que lo componen. */
  readonly href?: string | null;
  /** El cero de falsos pagar va en grande: es el argumento de seguridad. */
  readonly emphasis?: boolean;
}) {
  const body = (
    <>
      <span className="block text-[12px] font-medium tracking-wide text-ink-2 uppercase">
        {label}
      </span>
      <span
        className={`num mt-1 block font-semibold text-ink ${emphasis ? "text-[32px]" : "text-[24px]"}`}
      >
        {value}
      </span>
      {detail ? <span className="mt-1 block text-[12px] text-ink-3">{detail}</span> : null}
    </>
  );
  const frame = "block rounded-[var(--radius-card)] border border-line bg-surface p-4";
  return href ? (
    <Link href={href} className={`${frame} hover:border-line-strong`}>
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}
