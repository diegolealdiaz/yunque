import { CheckIcon, StopIcon } from "./icons";

/**
 * Lo que respondió el servidor a una acción: confirmación o error con causa y salida
 * (docs/interfaz.md §7). La confirmación va en tinta: el verde, el ámbar y el rojo son del
 * veredicto (§6). El error sí va en rojo, siempre con icono y texto.
 */

export type ActionResult = {
  readonly ok: boolean;
  readonly message: string;
  /** Qué hacer ahora, si hay algo que hacer. */
  readonly action: string | null;
} | null;

export function ActionOutcome({ state }: { readonly state: ActionResult }) {
  if (!state) return null;
  const Icon = state.ok ? CheckIcon : StopIcon;
  return (
    <div
      role={state.ok ? "status" : "alert"}
      className={`flex gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-[13px] ${
        state.ok
          ? "border-line bg-surface-sunken text-ink"
          : "border-hold/30 bg-hold-tint text-hold"
      }`}
    >
      <Icon className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">{state.message}</p>
        {state.action ? <p className="mt-0.5 text-ink">{state.action}</p> : null}
      </div>
    </div>
  );
}
