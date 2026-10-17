"use client";

import { useActionState } from "react";

import type { ChecklistItem } from "@/src/domain";

import { ApprovalChecklist } from "../../../_components/approval-checklist";

import { ActionOutcome } from "./action-outcome";
import { approveAction, chooseApprover, rejectAction } from "./actions";
import { CorrectionForm, ReevaluateButton, type EditableField } from "./correction-form";

/**
 * Columna "Tu decisión" de una escalada: quién resuelve, el checklist para aprobar y el
 * rechazo con motivo. El servidor decide; aquí solo se muestra lo que respondió.
 */

export function ResolutionPanel({
  invoiceId,
  payload,
  signature,
  signatureSummary,
  checklist,
  blocked,
  approvers,
  approver,
  editable,
  canReevaluate,
}: {
  readonly invoiceId: string;
  /** Contenido firmado por el servidor, en JSON. */
  readonly payload: string;
  readonly signature: string;
  readonly signatureSummary: string;
  readonly checklist: readonly ChecklistItem[];
  /** Por qué no se puede aprobar, o null. */
  readonly blocked: string | null;
  readonly approvers: readonly string[];
  /** Aprobador elegido (cookie verificada), o null. */
  readonly approver: string | null;
  readonly editable: readonly EditableField[];
  /** Hay una política más nueva o la espera venció: se ofrece reevaluar. */
  readonly canReevaluate: boolean;
}) {
  const [approved, approve, approving] = useActionState(approveAction, null);
  const [rejected, reject, rejecting] = useActionState(rejectAction, null);
  const hidden = { invoiceId, payload, signature };

  return (
    <div className="space-y-4">
      <form action={chooseApprover} className="flex items-end gap-2 text-[13px]">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <label className="flex-1">
          <span className="block text-[12px] text-ink-3">Resuelves como</span>
          <select
            // Se vuelve a montar al cambiar el aprobador para mostrar el elegido.
            key={approver ?? "ninguno"}
            name="approver"
            defaultValue={approver ?? ""}
            className="mt-1 h-8 w-full rounded-[var(--radius-control)] border border-control bg-surface px-2 text-ink"
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

      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <ApprovalChecklist
          items={checklist}
          signature={signatureSummary}
          formAction={approve}
          hiddenFields={hidden}
          pending={approving}
          disabledReason={
            blocked ?? (approver === null ? "Elige quién resuelve para poder aprobar." : null)
          }
        />
      </div>
      <ActionOutcome state={approved} />

      <details className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-[13px]">
        <summary className="cursor-pointer font-medium text-ink">Rechazar…</summary>
        <form action={reject} className="mt-3 space-y-2">
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <label className="block">
            <span className="block text-[12px] text-ink-3">Motivo (queda en la bitácora)</span>
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={1000}
              rows={3}
              className="mt-1 w-full rounded-[var(--radius-control)] border border-control bg-surface p-2 text-ink"
            />
          </label>
          <button
            type="submit"
            disabled={rejecting || approver === null}
            className="h-8 rounded-[var(--radius-control)] border border-hold-solid px-3 font-medium text-hold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {rejecting ? "Rechazando…" : "Rechazar"}
          </button>
          <p className="text-[12px] text-ink-3">Un rechazo es final: la factura no se pagará.</p>
        </form>
      </details>
      <ActionOutcome state={rejected} />

      <CorrectionForm
        invoiceId={invoiceId}
        fields={editable}
        disabledReason={approver === null ? "Elige quién resuelve para poder corregir." : null}
      />
      {canReevaluate ? (
        <ReevaluateButton
          invoiceId={invoiceId}
          disabledReason={approver === null ? "Elige quién resuelve para poder reevaluar." : null}
        />
      ) : null}
    </div>
  );
}
