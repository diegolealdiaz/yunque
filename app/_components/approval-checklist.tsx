"use client";

import { useState } from "react";

import type { ChecklistItem } from "@/src/domain";

/**
 * Checklist de aprobación (principio 5: aprobar es un acto, no un clic). Cada punto nombra
 * lo que la persona verificó; "Aprobar" se habilita solo con todos marcados y no tiene
 * atajo de teclado a propósito. Debajo se muestra en claro lo que se firma.
 *
 * Es un formulario: cada casilla marcada viaja como `check` con su código, junto a los
 * campos ocultos (el contenido firmado por el servidor). La verificación real vive en el
 * servidor; esta pantalla solo refleja lo que el servidor decidirá.
 */
export function ApprovalChecklist({
  items,
  signature,
  formAction = null,
  hiddenFields = {},
  disabledReason = null,
  pending = false,
}: {
  readonly items: readonly ChecklistItem[];
  /** Lo que se firma, en claro: "doc 3f9a…, política v4, 4.800.000 COP a ****4471". */
  readonly signature: string;
  /** Acción del servidor que recibe el formulario; sin ella, el checklist es de muestra. */
  readonly formAction?: ((formData: FormData) => void) | null;
  readonly hiddenFields?: Readonly<Record<string, string>>;
  /** Si no se puede aprobar por otra razón (sin aprobador, ya resuelta), se dice por qué. */
  readonly disabledReason?: string | null;
  readonly pending?: boolean;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(items.filter((i) => i.checked).map((i) => i.code)),
  );
  const complete = items.every((item) => checked.has(item.code));
  const missing = items.length - checked.size;

  const toggle = (code: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <form action={formAction ?? undefined} className="space-y-3">
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-[13px] text-ink-3">
          Para aprobar, marca lo que verificaste:
        </legend>
        {items.map((item) => (
          <label
            key={item.code}
            className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-[19px] text-ink"
          >
            <input
              type="checkbox"
              name="check"
              value={item.code}
              checked={checked.has(item.code)}
              onChange={() => toggle(item.code)}
              className="mt-px size-4 shrink-0 accent-[var(--brand)]"
            />
            <span>{item.text}</span>
          </label>
        ))}
      </fieldset>
      <button
        type="submit"
        disabled={!complete || disabledReason !== null || pending || formAction === null}
        aria-describedby="approval-status"
        className="h-10 w-full btn-primary px-4 text-[14px]"
      >
        {pending ? "Aprobando…" : "Aprobar"}
      </button>
      <p id="approval-status" className="text-[12px] text-ink-3">
        {disabledReason ??
          (complete
            ? "Todo verificado. Al aprobar quedan registrados tu nombre y la hora."
            : `Faltan ${String(missing)} ${missing === 1 ? "punto" : "puntos"} por marcar.`)}
      </p>
      <p className="rounded-[var(--radius-control)] bg-surface-sunken px-2 py-1.5 font-mono text-[12px] text-ink-2">
        Firma: {signature}
      </p>
    </form>
  );
}
