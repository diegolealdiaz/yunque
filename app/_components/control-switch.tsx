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
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const value = checked;
  const next = !value;

  return (
    <div className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
      <div>
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="text-[12px] text-ink-2">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => dialog.current?.showModal()}
        className="inline-flex h-7 items-center gap-2 rounded-full border border-control px-1 pr-3 text-[12px] font-medium text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={`size-5 rounded-full transition-colors ${value ? "bg-ink" : "border border-control bg-surface"}`}
        />
        {value ? onLabel : offLabel}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-5 text-ink backdrop:bg-ink/30"
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
            className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface"
          >
            Confirmar
          </button>
        </form>
      </dialog>
    </div>
  );
}
