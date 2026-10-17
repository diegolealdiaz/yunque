"use client";

import { useActionState, useState } from "react";

import type { ExplanationRating } from "@/src/usecases";

import { ActionOutcome } from "../../../_components/action-outcome";

import { rateExplanationAction } from "./actions";

/**
 * "¿Fue clara la explicación?" al pie de la tarjeta "Por qué": sí o no, y un comentario
 * opcional cuando no se entendió. La opinión queda en la bitácora; no cambia la decisión.
 */
export function ExplanationFeedback({
  invoiceId,
  decisionId,
  current,
}: {
  readonly invoiceId: string;
  readonly decisionId: string;
  /** La opinión que ya cuenta para esta decisión, o null. */
  readonly current: ExplanationRating | null;
}) {
  const [state, action, pending] = useActionState(rateExplanationAction, null);
  // "Sí" se envía de una; "No" abre el comentario y se envía con "Enviar".
  const [explaining, setExplaining] = useState(false);
  const choice = current ? (current.clear ? "si" : "no") : null;

  const option = (value: "si" | "no", label: string) => (
    <button
      type={value === "si" ? "submit" : "button"}
      name={value === "si" ? "clear" : undefined}
      value={value === "si" ? value : undefined}
      disabled={pending}
      aria-pressed={choice === value || (value === "no" && explaining)}
      aria-expanded={value === "no" ? explaining : undefined}
      onClick={value === "no" ? () => setExplaining(!explaining) : undefined}
      className={`h-8 rounded-full border px-3.5 text-[13px] font-medium disabled:opacity-60 ${
        choice === value || (value === "no" && explaining)
          ? "border-ink bg-ink text-surface"
          : "border-control text-ink hover:bg-surface-hover"
      }`}
    >
      {label}
    </button>
  );

  return (
    <form action={action} className="mt-4 border-t border-line/70 pt-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="decisionId" value={decisionId} />
      <div className="flex flex-wrap items-center gap-2">
        <p id="fue-clara" className="mr-1 text-[13px] text-ink-2">
          ¿Fue clara la explicación?
        </p>
        <div role="group" aria-labelledby="fue-clara" className="flex gap-2">
          {option("si", "Sí")}
          {option("no", "No")}
        </div>
      </div>
      {explaining ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-[12px] text-ink-3">
            Qué no se entendió (opcional)
            <input
              name="comment"
              maxLength={500}
              className="h-9 rounded-[var(--radius-control)] border border-control bg-surface px-2.5 text-[13px] text-ink"
            />
          </label>
          <button
            type="submit"
            name="clear"
            value="no"
            disabled={pending}
            className="h-9 rounded-[var(--radius-control)] border border-control px-3.5 text-[13px] font-medium text-ink hover:bg-surface-hover disabled:opacity-60"
          >
            Enviar
          </button>
        </div>
      ) : null}
      {state ? (
        <div className="mt-3">
          <ActionOutcome state={state} />
        </div>
      ) : null}
    </form>
  );
}
