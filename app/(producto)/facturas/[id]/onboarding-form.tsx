"use client";

import { useActionState } from "react";

import type { VendorDraft } from "@/src/usecases";
import { RAIL_LABEL } from "@/src/ui/labels";

import { ActionOutcome } from "../../../_components/action-outcome";

import { onboardAction } from "./actions";

/**
 * Registro del proveedor desde su factura: los datos vienen de lo que leyó el agente y la
 * persona los revisa contra el documento. Pide confirmar que los verificó con el proveedor por
 * otro canal y, si el nombre se parece a uno registrado, que es otra empresa.
 */
export function OnboardingForm({
  invoiceId,
  draft,
  disabledReason,
}: {
  readonly invoiceId: string;
  readonly draft: VendorDraft;
  readonly disabledReason: string | null;
}) {
  const [state, action, pending] = useActionState(onboardAction, null);
  const input =
    "mt-1 h-9 w-full rounded-[var(--radius-control)] border border-control bg-surface px-2 text-ink";
  return (
    <form action={action} className="space-y-3 text-[13px]">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <p className="text-ink-2">
        Revisa los datos contra el documento. La cuenta queda registrada: las próximas facturas de
        este proveedor se pagan solo a ella.
      </p>
      <label className="block">
        <span className="text-[12px] text-ink-3">Nombre del proveedor</span>
        <input name="nombre" required maxLength={200} defaultValue={draft.name} className={input} />
      </label>
      <label className="block">
        <span className="text-[12px] text-ink-3">Identificación (NIT, RFC, CNPJ…)</span>
        <input
          name="identificacion"
          maxLength={50}
          defaultValue={draft.taxId ?? ""}
          className={input}
        />
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
        <label className="block min-w-0">
          <span className="text-[12px] text-ink-3">Cuenta de pago</span>
          <input
            name="cuenta"
            required
            maxLength={40}
            defaultValue={draft.accountNumber}
            className={`${input} font-mono`}
          />
        </label>
        <label className="block">
          <span className="text-[12px] text-ink-3">Cómo se le paga</span>
          <select name="ruta" defaultValue={draft.rails[0]} className={input}>
            {draft.rails.map((rail) => (
              <option key={rail} value={rail}>
                {RAIL_LABEL[rail]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-[12px] text-ink-3">Titular de la cuenta</span>
        <input
          name="titular"
          required
          maxLength={200}
          defaultValue={draft.holderName}
          className={input}
        />
      </label>
      <p className="text-[12px] text-ink-3">
        Moneda {draft.currency} · {draft.country}
      </p>

      {draft.lookalike ? (
        <label className="flex items-start gap-2 rounded-[var(--radius-control)] bg-escalate-tint px-3 py-2 text-ink">
          <input type="checkbox" name="otra_empresa" className="mt-0.5 accent-[var(--ink)]" />
          <span>
            Se parece a <strong>«{draft.lookalike}»</strong>, que ya está registrado. Confirmo que
            es otra empresa: un nombre casi igual es una forma común de fraude.
          </span>
        </label>
      ) : null}
      <label className="flex items-start gap-2 text-ink">
        <input type="checkbox" name="confirmado" required className="mt-0.5 accent-[var(--ink)]" />
        <span>
          Confirmé estos datos con el proveedor por teléfono o por un canal que ya conocía, no por
          la factura.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending || disabledReason !== null}
        className="h-9 w-full btn-primary px-4"
      >
        {pending ? "Registrando y reevaluando…" : "Registrar proveedor"}
      </button>
      <p className="text-[12px] text-ink-3">
        {disabledReason ??
          (draft.fourEyes
            ? "Con la doble firma, otra persona de la lista verifica al proveedor al aprobar la factura."
            : "El proveedor queda verificado con tu nombre; después apruebas la factura.")}
      </p>
      <ActionOutcome state={state} />
    </form>
  );
}
