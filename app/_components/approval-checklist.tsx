"use client";

import { useState } from "react";

import type { ChecklistItem } from "@/src/domain";

/**
 * Checklist de aprobación (principio 5: aprobar es un acto, no un clic). Cada punto nombra
 * lo que la persona verificó; "Aprobar" se habilita solo con todos marcados y no tiene
 * atajo de teclado a propósito. Debajo se muestra en claro lo que se firma.
 *
 * La verificación real (firma del contenido exacto, primera resolución gana) vive en el
 * servidor; este componente solo refleja lo que el servidor decidirá.
 */
export function ApprovalChecklist({
  items,
  signature,
  onApprove = null,
  disabledReason = null,
}: {
  readonly items: readonly ChecklistItem[];
  /** Lo que se firma, en claro: "doc 3f9a…, política v4, 4.800.000 COP a ****4471". */
  readonly signature: string;
  readonly onApprove?: ((checkedCodes: readonly string[]) => void) | null;
  /** Si no se puede aprobar por otra razón (sin rol, ya resuelta), se dice por qué. */
  readonly disabledReason?: string | null;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(items.filter((i) => i.checked).map((i) => i.code)),
  );
  const complete = items.every((item) => checked.has(item.code));
  const pending = items.length - checked.size;

  const toggle = (code: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <fieldset className="space-y-3">
      <legend className="text-[13px] font-medium text-ink">Para aprobar, marca:</legend>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.code}>
            <label className="flex cursor-pointer items-start gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={checked.has(item.code)}
                onChange={() => toggle(item.code)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
              />
              <span>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!complete || disabledReason !== null}
        aria-describedby="approval-status"
        onClick={() => onApprove?.([...checked])}
        className="h-9 w-full rounded-[var(--radius-control)] bg-ink px-4 text-[13px] font-medium text-surface disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-3"
      >
        Aprobar
      </button>
      <p id="approval-status" className="text-[12px] text-ink-3">
        {disabledReason ??
          (complete
            ? "Todo verificado. Al aprobar quedan registrados tu nombre y la hora."
            : `Faltan ${String(pending)} ${pending === 1 ? "punto" : "puntos"} por marcar.`)}
      </p>
      <p className="rounded-[var(--radius-control)] bg-surface-sunken px-2 py-1.5 font-mono text-[12px] text-ink-2">
        Firma: {signature}
      </p>
    </fieldset>
  );
}
