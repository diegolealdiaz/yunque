import type { ChipVerdict } from "./verdict-chip";

/**
 * Veredicto en una píldora pequeña, para las tablas: un punto de color y la palabra. El motivo
 * va en su propia columna; el chip con la regla al lado (`VerdictChip`) queda para los
 * encabezados y las listas cortas.
 */

const STYLE: Readonly<
  Record<ChipVerdict, { label: string; tint: string; dot: string; text: string }>
> = {
  pagar: { label: "Pagar", tint: "bg-pay-tint", dot: "bg-pay-solid", text: "text-pay" },
  escalar: {
    label: "Escalar",
    tint: "bg-escalate-tint",
    dot: "bg-escalate-solid",
    text: "text-escalate",
  },
  frenar: { label: "Frenar", tint: "bg-hold-tint", dot: "bg-hold-solid", text: "text-hold" },
  en_proceso: {
    label: "En proceso",
    tint: "bg-pending-tint",
    dot: "bg-ink-3",
    text: "text-pending",
  },
};

export function VerdictPill({ verdict }: { readonly verdict: ChipVerdict }) {
  const style = STYLE[verdict];
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap ${style.tint} ${style.text}`}
    >
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
