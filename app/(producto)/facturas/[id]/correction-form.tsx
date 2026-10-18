"use client";

import { useActionState } from "react";

import type { ExtractedFieldName } from "@/src/domain";

import { ActionOutcome } from "../../../_components/action-outcome";

import { correctAction, reevaluateAction } from "./actions";

/**
 * Corregir campos a mano y reevaluar (docs/interfaz.md §5.2, columna 3). Cada valor se
 * edita como texto; "confirmar" fija un valor leído sin cambiarlo (un total ambiguo que el
 * agente leyó bien). Lo corregido queda con el nombre de quien lo hizo y, para pagar, lo
 * aprueba otra persona.
 */

export type EditableField = {
  readonly name: ExtractedFieldName;
  readonly label: string;
  /** Valor vigente como se edita: montos con punto y dos decimales, fechas AAAA-MM-DD. */
  readonly value: string;
  readonly hint: string | null;
};

export function CorrectionForm({
  invoiceId,
  fields,
  disabledReason,
}: {
  readonly invoiceId: string;
  readonly fields: readonly EditableField[];
  readonly disabledReason: string | null;
}) {
  const [state, action, pending] = useActionState(correctAction, null);
  return (
    <div className="text-[13px]">
      <form action={action} className="space-y-2">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        {fields.map((field) => (
          <div
            key={field.name}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2"
          >
            <label htmlFor={`campo-${field.name}`} className="text-ink-2">
              {field.label}
            </label>
            <input
              id={`campo-${field.name}`}
              name={`campo:${field.name}`}
              defaultValue={field.value}
              placeholder={field.hint ?? ""}
              className="h-8 min-w-0 rounded-[var(--radius-control)] border border-control bg-surface px-2 font-mono text-[12px] text-ink"
            />
            <label
              className="inline-flex items-center gap-1 text-[12px] text-ink-3"
              title="Confirmar el valor leído sin cambiarlo"
            >
              <input
                type="checkbox"
                name="confirmar"
                aria-label={`Confirmar ${field.label} sin cambiarlo`}
                value={field.name}
                disabled={field.value === ""}
                className="accent-[var(--ink)]"
              />
              confirmar
            </label>
          </div>
        ))}
        <button
          type="submit"
          disabled={pending || disabledReason !== null}
          className="h-8 btn-primary px-3"
        >
          {pending ? "Reevaluando…" : "Corregir y reevaluar"}
        </button>
        <p className="text-[12px] text-ink-3">
          {disabledReason ??
            "Lo que corrijas queda con tu nombre. Para pagar, otra persona de la lista lo aprueba."}
        </p>
      </form>
      <div className="mt-2">
        <ActionOutcome state={state} />
      </div>
    </div>
  );
}

/** Vuelve a evaluar la misma lectura con la política vigente. */
export function ReevaluateButton({
  invoiceId,
  disabledReason,
}: {
  readonly invoiceId: string;
  readonly disabledReason: string | null;
}) {
  const [state, action, pending] = useActionState(reevaluateAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button
        type="submit"
        disabled={pending || disabledReason !== null}
        className="h-8 w-full rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Reevaluando…" : "Reevaluar con la política vigente"}
      </button>
      {disabledReason ? <p className="text-[12px] text-ink-3">{disabledReason}</p> : null}
      <ActionOutcome state={state} />
    </form>
  );
}
