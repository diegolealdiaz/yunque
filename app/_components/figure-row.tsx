import Link from "next/link";

/**
 * Una fila de cifra de una franja de resumen: nombre y detalle a la izquierda, valor en mono
 * a la derecha, separada de la siguiente por una línea. Va dentro de un `<dl>`.
 */
export function FigureRow({
  label,
  detail,
  value,
  href = null,
}: {
  readonly label: string;
  readonly detail: string;
  readonly value: string;
  readonly href?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <dt className="min-w-0 text-[13px] text-ink-2">
        {label}
        <span className="block text-[12px] text-ink-3">{detail}</span>
      </dt>
      <dd className="font-mono text-[14px] whitespace-nowrap text-ink">
        {href ? (
          <Link href={href} className="underline-offset-4 hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
