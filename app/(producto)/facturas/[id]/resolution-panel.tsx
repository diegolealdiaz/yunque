"use client";

import { useActionState } from "react";

import type { ChecklistItem } from "@/src/domain";
import type { PendingVendor, VendorDraft } from "@/src/usecases";

import { ActionDialog } from "../../../_components/action-dialog";
import { ActionOutcome } from "../../../_components/action-outcome";
import { ApprovalChecklist } from "../../../_components/approval-checklist";
import { ApproverPicker } from "../../../_components/approver-picker";

import { approveAction, rejectAction } from "./actions";
import { CorrectionForm, ReevaluateButton, type EditableField } from "./correction-form";
import { OnboardingForm } from "./onboarding-form";

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
  onboarding,
  pendingVendor,
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
  /** El beneficiario no está registrado: el alta prellenada, o null. */
  readonly onboarding: VendorDraft | null;
  /** El proveedor ya está registrado pero falta verificarlo, o null. */
  readonly pendingVendor: PendingVendor | null;
}) {
  const [approved, approve, approving] = useActionState(approveAction, null);
  const [rejected, reject, rejecting] = useActionState(rejectAction, null);
  const hidden = { invoiceId, payload, signature };

  return (
    <div className="space-y-4">
      <ApproverPicker approvers={approvers} approver={approver} path={`/facturas/${invoiceId}`} />

      {pendingVendor ? (
        <p className="rounded-[var(--radius-control)] border border-line bg-surface-sunken p-3 text-[13px] text-ink">
          <strong>{pendingVendor.name}</strong>{" "}
          {pendingVendor.registeredBy
            ? `fue registrado por ${pendingVendor.registeredBy} y falta verificarlo.`
            : "está registrado y falta verificarlo."}{" "}
          {pendingVendor.fourEyes
            ? "Lo verifica otra persona de la lista al aprobar esta factura."
            : "Se verifica al aprobar esta factura."}
        </p>
      ) : null}

      {onboarding ? (
        <div className="space-y-2 rounded-[var(--radius-control)] border border-line bg-surface-sunken p-3">
          <p className="text-[13px] text-ink">
            <strong>{onboarding.name}</strong> no está registrado como proveedor. Si es legítimo,
            regístralo con los datos de esta factura para poder pagarle.
          </p>
          <ActionDialog label="Registrar proveedor" block primary>
            <OnboardingForm
              invoiceId={invoiceId}
              draft={onboarding}
              disabledReason={approver === null ? "Elige arriba quién resuelve." : null}
            />
          </ActionDialog>
        </div>
      ) : null}

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
      <ActionOutcome state={approved} />

      {/* Rechazar y corregir, lado a lado: cada uno abre su formulario en un diálogo. */}
      <div className="grid grid-cols-2 gap-2">
        <ActionDialog label="Rechazar" block>
          <form action={reject} className="space-y-2 text-[13px]">
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
              className="h-9 rounded-[var(--radius-control)] border border-hold-solid px-4 font-medium text-hold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {rejecting ? "Rechazando…" : "Rechazar"}
            </button>
            <p className="text-[12px] text-ink-3">
              {approver === null
                ? "Elige quién resuelve para poder rechazar."
                : "Un rechazo es final: la factura no se pagará."}
            </p>
          </form>
          <div className="mt-2">
            <ActionOutcome state={rejected} />
          </div>
        </ActionDialog>
        <ActionDialog label="Corregir campo" block>
          <CorrectionForm
            invoiceId={invoiceId}
            fields={editable}
            disabledReason={approver === null ? "Elige quién resuelve para poder corregir." : null}
          />
        </ActionDialog>
      </div>
      {canReevaluate ? (
        <ReevaluateButton
          invoiceId={invoiceId}
          disabledReason={approver === null ? "Elige quién resuelve para poder reevaluar." : null}
        />
      ) : null}
    </div>
  );
}
