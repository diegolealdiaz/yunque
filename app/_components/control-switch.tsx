"use client";

import { useId, useRef } from "react";

/**
 * Interruptor de control: pagos habilitados, modo de prueba, autonomía. No son política
 * sino control, y cambiarlos exige confirmar en un diálogo que dice qué va a pasar
 * (docs/interfaz.md §5.4). El cambio real lo registra el servidor en la bitácora.
 *
 * Muestra siempre el valor que confirmó el servidor (`checked`), nunca uno supuesto: si el
 * servidor rechaza el cambio, el interruptor no miente sobre el estado de los pagos.
 */
/** Color de un estado: el del veredicto que evoca, o la marca; neutro si no dice nada. */
export type SwitchTone = "pay" | "escalate" | "hold" | "brand" | "neutral";

const TRACK: Readonly<Record<SwitchTone, string>> = {
  pay: "bg-pay-solid",
  escalate: "bg-escalate-solid",
  hold: "bg-hold-solid",
  brand: "bg-brand",
  neutral: "bg-surface-sunken ring-1 ring-control ring-inset",
};

const TEXT: Readonly<Record<SwitchTone, string>> = {
  pay: "text-pay",
  escalate: "text-escalate",
  hold: "text-hold",
  brand: "text-brand",
  neutral: "text-ink-2",
};

export function ControlSwitch({
  label,
  description,
  checked,
  onLabel = "Encendido",
  offLabel = "Apagado",
  confirmOn,
  confirmOff,
  onChange = null,
  disabled = false,
  onTone = "brand",
  offTone = "neutral",
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onLabel?: string;
  readonly offLabel?: string;
  /** Qué pasa al encender, en una frase. */
  readonly confirmOn: string;
  /** Qué pasa al apagar, en una frase. */
  readonly confirmOff: string;
  readonly onChange?: ((next: boolean) => void) | null;
  /** Sin quien firme, o con un cambio en curso, no se puede cambiar. */
  readonly disabled?: boolean;
  /** Color del riel y del estado encendido y apagado. */
  readonly onTone?: SwitchTone;
  readonly offTone?: SwitchTone;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const value = checked;
  const next = !value;
  const tone = value ? onTone : offTone;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 card px-4 py-3">
      <p className="text-[13px] font-medium text-ink">{label}</p>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => dialog.current?.showModal()}
        className={`inline-flex items-center gap-2.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${TEXT[tone]}`}
      >
        {value ? onLabel : offLabel}
        <span
          aria-hidden="true"
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${TRACK[tone]}`}
        >
          <span
            className={`absolute left-1 size-4 rounded-full shadow-sm transition-transform motion-reduce:transition-none ${
              value ? "translate-x-5 bg-white" : tone === "neutral" ? "bg-ink-3" : "bg-white"
            }`}
          />
        </span>
      </button>
      <p className="col-span-2 text-[12px] text-ink-2">{description}</p>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto max-w-sm card p-5 text-ink backdrop:bg-black/50"
      >
        <p id={titleId} className="text-[14px] font-medium">
          ¿Cambiar «{label}» a «{next ? onLabel : offLabel}»?
        </p>
        <p className="mt-2 text-[13px] text-ink-2">{next ? confirmOn : confirmOff}</p>
        <form method="dialog" className="mt-4 flex justify-end gap-2">
          <button className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              onChange?.(next);
              dialog.current?.close();
            }}
            className="h-8 btn-primary px-3 text-[13px]"
          >
            Confirmar
          </button>
        </form>
      </dialog>
    </div>
  );
}
