"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { FindingCode, Verdict } from "@/src/domain";
import { changeCountText } from "@/src/ui/format";
import { RULE_SHORT_LABEL } from "@/src/ui/labels";

import { ActionOutcome } from "../../_components/action-outcome";
import { VerdictChip } from "../../_components/verdict-chip";

import { approveProposalAction, discardProposalAction } from "./actions";

/**
 * Un cambio que afloja la política, a la espera de la segunda firma (cuatro ojos). Muestra
 * quién lo propuso, qué afloja y qué facturas abiertas cambiarían si se aprueba. Lo aprueba
 * otra persona de la lista; cualquiera puede descartarlo.
 */

export type ProposalView = {
  readonly id: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly baseVersion: number;
  readonly loosenings: readonly string[];
  readonly note: string | null;
  readonly stale: boolean;
  /** Lo que cambiaría al aprobarla; null si venció y ya no se puede aprobar. */
  readonly preview: {
    readonly evaluated: number;
    readonly changes: readonly {
      readonly invoiceId: string;
      readonly reference: string;
      readonly before: { readonly verdict: Verdict; readonly rule: FindingCode | null };
      readonly after: { readonly verdict: Verdict; readonly rule: FindingCode | null };
    }[];
  } | null;
};

export function ProposalPanel({
  proposal,
  signer,
}: {
  readonly proposal: ProposalView;
  /** Quien firma ahora (cookie verificada), o null. */
  readonly signer: string | null;
}) {
  const [approved, approve, approving] = useActionState(approveProposalAction, null);
  const [discarded, discard, discarding] = useActionState(discardProposalAction, null);
  const busy = approving || discarding;
  const ownProposal = signer === proposal.proposedBy;
  const canApprove = signer !== null && !ownProposal && !proposal.stale && !busy;
  return (
    <section
      aria-label="Cambio de reglas por aprobar"
      className="space-y-3 rounded-[var(--radius-card)] border border-escalate-solid/40 bg-escalate-tint px-5 py-4"
    >
      <div className="space-y-1">
        <p className="caps text-escalate">Cambio de reglas por aprobar</p>
        <p className="text-[15px] font-semibold text-ink">
          {proposal.proposedBy} propone aflojar las reglas · {proposal.proposedAt}
        </p>
        <p className="text-[13px] text-ink-2">
          Un cambio que afloja no entra en vigor con una sola firma: lo aprueba otra persona de la
          lista. Mientras tanto sigue la v{proposal.baseVersion}.
        </p>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink">
        {proposal.loosenings.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {proposal.note ? <p className="text-[13px] text-ink-2">Nota: {proposal.note}</p> : null}

      {proposal.stale ? (
        <p className="text-[13px] font-medium text-ink">
          La política cambió desde que se propuso: ya no se puede aprobar. Descártala y, si sigue
          haciendo falta, propónla de nuevo.
        </p>
      ) : proposal.preview ? (
        <div className="space-y-1.5 text-[13px]">
          <p className="font-medium text-ink">
            {changeCountText(
              proposal.preview.changes.length,
              proposal.preview.evaluated,
              "Si se aprueba",
            )}
          </p>
          {proposal.preview.changes.length > 0 ? (
            <ul className="divide-y divide-line">
              {proposal.preview.changes.map((change) => (
                <li key={change.invoiceId} className="flex flex-wrap items-center gap-2 py-1.5">
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
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <form action={approve}>
          <input type="hidden" name="propuesta" value={proposal.id} />
          <button type="submit" disabled={!canApprove} className="h-8 btn-primary px-3 text-[13px]">
            {approving ? "Aplicando y reevaluando…" : "Aprobar y aplicar"}
          </button>
        </form>
        <form action={discard}>
          <input type="hidden" name="propuesta" value={proposal.id} />
          <button
            type="submit"
            disabled={signer === null || busy}
            className="h-8 rounded-[var(--radius-control)] border border-control bg-surface px-3 text-[13px] font-medium text-ink"
          >
            {discarding ? "Descartando…" : "Descartar"}
          </button>
        </form>
        <p className="text-[12px] text-ink-2">
          {signer === null
            ? "Elige arriba quién firma para aprobar o descartar."
            : ownProposal && !proposal.stale
              ? "Tú lo propusiste: lo aprueba otra persona. Cambia «Firmas como» para probarlo."
              : null}
        </p>
      </div>
      <ActionOutcome state={approved ?? discarded} />
    </section>
  );
}
