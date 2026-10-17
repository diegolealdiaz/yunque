"use client";

import Link from "next/link";
import { useId, type RefObject } from "react";

import { RULE_SHORT_LABEL } from "@/src/ui/labels";

import { VerdictChip } from "../../_components/verdict-chip";

import type { PreviewState } from "./actions";

/**
 * Los dos diálogos de Reglas: el resultado de "Ver qué cambiaría" y la confirmación de
 * guardar. Los abre y cierra `PolicyWorkbench`; aquí solo se dibujan.
 */

/** Qué facturas abiertas cambiarían de veredicto con la política editada (D18). */
export function PreviewDialog({
  dialogRef,
  preview,
  stale,
  canSave,
  version,
  onSave,
}: {
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
  readonly preview: PreviewState;
  /** La política cambió después de calcular: el resultado ya no la describe. */
  readonly stale: boolean;
  readonly canSave: boolean;
  readonly version: number;
  readonly onSave: () => void;
}) {
  const titleId = useId();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto w-full max-w-xl rounded-[var(--radius-card)] border border-line bg-surface p-5 text-ink backdrop:bg-ink/30"
    >
      {preview?.ok === false ? (
        <div className="space-y-2 text-[13px]">
          <p id={titleId} className="text-[14px] font-medium text-hold">
            La política no es válida
          </p>
          <ul className="list-disc space-y-1 pl-5 text-ink-2">
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview?.ok ? (
        <div className="space-y-3 text-[13px]">
          <p id={titleId} className="text-[14px] font-medium">
            {preview.changes.length === 0
              ? `Ninguna de las ${String(preview.evaluated - preview.skipped)} facturas abiertas cambiaría de veredicto.`
              : `${String(preview.changes.length)} de ${String(preview.evaluated - preview.skipped)} facturas abiertas cambiarían de veredicto`}
          </p>
          {stale ? (
            <p className="text-[12px] font-medium text-ink">
              Editaste la política después de calcular: vuelve a ver qué cambiaría.
            </p>
          ) : null}
          {preview.changes.length > 0 ? (
            <ul
              className={`max-h-[50vh] divide-y divide-line overflow-y-auto ${stale ? "opacity-60" : ""}`}
            >
              {preview.changes.map((change) => (
                <li key={change.invoiceId} className="flex flex-wrap items-center gap-2 py-2">
                  <Link
                    href={`/facturas/${change.invoiceId}`}
                    className="w-36 font-mono text-[12px] text-ink underline underline-offset-4"
                  >
                    {change.reference}
                  </Link>
                  <VerdictChip verdict={change.before.verdict} />
                  {change.before.rule ? (
                    <span className="text-ink-3">{RULE_SHORT_LABEL[change.before.rule]}</span>
                  ) : null}
                  <span aria-hidden="true" className="text-ink-3">
                    →
                  </span>
                  <span className="sr-only">pasaría a</span>
                  <VerdictChip verdict={change.after.verdict} />
                  {change.after.rule ? (
                    <span className="text-ink-3">{RULE_SHORT_LABEL[change.after.rule]}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.skipped > 0 ? (
            <p className="text-[12px] text-ink-3">
              {preview.skipped} sin lectura guardada no se pueden reevaluar.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px]"
        >
          Cerrar
        </button>
        {preview?.ok && !stale ? (
          <button
            type="button"
            disabled={!canSave}
            onClick={onSave}
            className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-3"
          >
            Guardar como v{version + 1}
          </button>
        ) : null}
      </div>
    </dialog>
  );
}

/** Confirmación de guardar: firma, nota opcional y reevaluación de las facturas abiertas. */
export function SaveDialog({
  dialogRef,
  yaml,
  version,
  onSubmit,
}: {
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
  readonly yaml: string;
  readonly version: number;
  readonly onSubmit: (data: FormData) => void;
}) {
  const titleId = useId();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-5 text-ink backdrop:bg-ink/30"
    >
      <form
        action={(data) => {
          dialogRef.current?.close();
          onSubmit(data);
        }}
        className="space-y-3"
      >
        <p id={titleId} className="text-[14px] font-medium">
          ¿Guardar la política como v{version + 1}?
        </p>
        <p className="text-[13px] text-ink-2">
          Queda firmada con tu nombre y se reevalúan las facturas abiertas con ella. Las pagadas no
          se tocan.
        </p>
        <input type="hidden" name="yaml" value={yaml} />
        <input type="hidden" name="version" value={version} />
        <label className="block text-[13px]">
          <span className="text-[12px] text-ink-3">Nota (opcional, queda en la versión)</span>
          <input
            name="nota"
            maxLength={500}
            className="mt-1 h-8 w-full rounded-[var(--radius-control)] border border-control px-2"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="h-8 rounded-[var(--radius-control)] bg-ink px-3 text-[13px] font-medium text-surface"
          >
            Guardar y reevaluar
          </button>
        </div>
      </form>
    </dialog>
  );
}
