import { chooseApprover } from "../_actions/approver";

/**
 * "Resuelves como": quién firma lo que se haga en esta pantalla, elegido de la lista de
 * aprobadores de la política. El selector se vuelve a montar al cambiar para mostrar el
 * elegido.
 */
export function ApproverPicker({
  approvers,
  approver,
  path,
  label = "Resuelves como",
  inline = false,
}: {
  readonly approvers: readonly string[];
  readonly approver: string | null;
  /** Ruta a refrescar después de elegir. */
  readonly path: string;
  readonly label?: string;
  /** Etiqueta a la izquierda del selector, en una sola línea (encabezados). */
  readonly inline?: boolean;
}) {
  return (
    <form action={chooseApprover} className="flex items-end gap-2 text-[13px]">
      <input type="hidden" name="path" value={path} />
      <label className={inline ? "flex flex-1 items-center gap-2" : "flex-1"}>
        <span className={`text-[12px] text-ink-3 ${inline ? "whitespace-nowrap" : "block"}`}>
          {label}
        </span>
        <select
          key={approver ?? "ninguno"}
          name="approver"
          defaultValue={approver ?? ""}
          className={`h-8 w-full rounded-[var(--radius-control)] ${inline ? "min-w-44" : "mt-1"} border border-control bg-surface px-2 text-ink`}
        >
          <option value="" disabled>
            Elige un aprobador
          </option>
          {approvers.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="h-8 rounded-[var(--radius-control)] border border-control px-3 font-medium text-ink"
      >
        Usar
      </button>
    </form>
  );
}
