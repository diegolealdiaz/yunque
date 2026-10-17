import type { InvoiceStatus } from "@/src/domain";
import { STATUS_LABEL } from "@/src/ui/labels";

/**
 * Estado de la factura en una lista: punto de color y texto en tinta. El punto toma el color
 * del veredicto con el que se relaciona (ámbar espera a una persona, rojo se detuvo, verde se
 * aprobó) y gris lo que sigue en curso; el texto siempre dice lo mismo, así el color nunca va
 * solo (docs/interfaz.md §6).
 */

const DOT: Readonly<Record<InvoiceStatus, string>> = {
  recibida: "bg-ink-3",
  procesando: "bg-ink-3",
  decidida: "bg-ink",
  esperando_aprobacion: "bg-escalate-solid",
  aprobada: "bg-pay-solid",
  rechazada: "bg-hold-solid",
  fallida: "bg-hold-solid",
};

export function StatusBadge({ status }: { readonly status: InvoiceStatus }) {
  const label = STATUS_LABEL[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-ink">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[status]}`} />
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}
