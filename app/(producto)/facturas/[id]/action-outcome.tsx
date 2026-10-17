import type { ResolutionState } from "./actions";

/** Lo que respondió el servidor a una acción: confirmación o error con causa y salida. */
export function ActionOutcome({ state }: { readonly state: ResolutionState }) {
  if (!state) return null;
  return (
    <div
      role={state.ok ? "status" : "alert"}
      className={`rounded-[var(--radius-control)] px-3 py-2 text-[13px] ${state.ok ? "bg-pay-tint text-pay" : "bg-hold-tint text-hold"}`}
    >
      <p className="font-medium">{state.message}</p>
      {state.action ? <p className="mt-0.5 text-ink">{state.action}</p> : null}
    </div>
  );
}
