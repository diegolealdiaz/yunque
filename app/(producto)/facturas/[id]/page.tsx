import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { EXTRACTED_FIELD_NAMES, formatMoney } from "@/src/domain";
import { APPROVER_COOKIE, verifyApprover } from "@/src/session";
import { FIELD_LABEL } from "@/src/ui/labels";
import { timelineLines } from "@/src/ui/timeline";
import {
  approvalOffer,
  editableValue,
  isNotFound,
  loadExplanationRating,
  loadInvoiceDetail,
  type InvoiceDetail,
} from "@/src/usecases";

import { DocumentViewer, EvidenceProvider } from "../../../_components/document-viewer";
import { Timeline } from "../../../_components/timeline";
import { VerdictChip } from "../../../_components/verdict-chip";
import { appContext } from "../../../_data/context";
import { fileStorage } from "../../../_data/storage";

import { AgentReview } from "./agent-review";
import { DecisionPanel, type Resolution } from "./decision-panel";
import { DATE_FIELDS, MONEY_FIELDS, SubTitle } from "./parts";
import { WhyCard } from "./why-card";

export const metadata = { title: "Factura · Yunque" };

/**
 * Detalle de una decisión (docs/interfaz.md §5.2). Arriba, quién cobra, cuánto y el "Por
 * qué". Debajo, tres columnas, una pregunta cada una: qué dice el documento, qué leyó y
 * decidió el agente (agent-review.tsx), y qué hace la persona (decision-panel.tsx). Todo lo
 * que viene del documento se pinta como texto; la imagen la sirve el servidor, nunca el PDF.
 */

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { config, db, organization } = await appContext();
  const detail = await loadInvoiceDetail(db, fileStorage(), organization.id, id).catch(
    (error: unknown) => {
      if (isNotFound(error)) notFound();
      throw error;
    },
  );
  const { invoice, decision } = detail;
  const rating = decision
    ? await loadExplanationRating(db, organization.id, invoice.id, decision.id)
    : null;
  const offer =
    invoice.status === "esperando_aprobacion"
      ? await approvalOffer(
          { db, signingSecret: config.secrets.approvalSigning, now: () => new Date() },
          organization.id,
          invoice.id,
        )
      : null;
  const approver = verifyApprover(
    (await cookies()).get(APPROVER_COOKIE)?.value,
    config.secrets.session,
  );
  const resolution = offer ? resolutionFor(detail, offer, approver) : null;

  return (
    <div className="space-y-6 pb-12">
      <DetailHeader detail={detail} />

      <WhyCard detail={detail} fx={organization.fx} rating={rating} />

      <EvidenceProvider>
        {/*
          Tres columnas en pantallas grandes. Entre 1024 y 1280 px, dos: el documento a la
          izquierda y, a la derecha, la decisión arriba y lo leído debajo, así "Tu decisión"
          se ve sin desplazarse en un portátil o un proyector.
        */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_19rem]">
          <Column
            title="Documento"
            className="lg:col-start-1 lg:row-span-2 lg:row-start-1 xl:row-span-1"
          >
            <DocumentViewer
              pages={detail.pages.map((p) => ({
                src: `/facturas/${invoice.id}/pagina/${String(p.number)}`,
                width: p.width,
                height: p.height,
              }))}
              text={invoice.text ?? ""}
              highlights={detail.fields.map((f) => ({
                id: f.name,
                label: FIELD_LABEL[f.name],
                quote: f.literal,
                page: f.page,
                box: f.box,
              }))}
            />
          </Column>

          <Column
            title="Lo que leyó y revisó el agente"
            className="lg:col-start-2 lg:row-start-2 xl:row-start-1"
          >
            <AgentReview detail={detail} />
          </Column>

          <Column title="Tu decisión" className="lg:col-start-2 lg:row-start-1 xl:col-start-3">
            <DecisionPanel
              detail={detail}
              resolution={resolution}
              approver={approver}
              timeZone={config.displayTimeZone}
            />
            <div>
              <SubTitle>Línea de tiempo</SubTitle>
              <div className="mt-2">
                <Timeline
                  entries={timelineLines(detail.timeline)}
                  timeZone={config.displayTimeZone}
                />
              </div>
              <Link
                href={`/bitacora?factura=${invoice.reference}`}
                className="mt-2 inline-block text-[12px] text-ink-2 underline underline-offset-4"
              >
                Ver todos sus eventos en la bitácora
              </Link>
            </div>
          </Column>
        </div>
      </EvidenceProvider>
    </div>
  );
}

type Offer = NonNullable<Awaited<ReturnType<typeof approvalOffer>>>;

/** Lo que necesita el panel de aprobación: la oferta firmada y los campos editables. */
function resolutionFor(detail: InvoiceDetail, offer: Offer, approver: string | null): Resolution {
  const readFields =
    detail.extraction?.extraction.kind === "invoice" ? detail.extraction.extraction.fields : null;
  return {
    invoiceId: detail.invoice.id,
    payload: JSON.stringify(offer.payload),
    signature: offer.signature,
    signatureSummary: detail.signatureSummary ?? "sin contenido para firmar",
    checklist: offer.checklist,
    blocked: offer.blocked,
    approvers: detail.approvers,
    approver,
    editable: EXTRACTED_FIELD_NAMES.map((name) => ({
      name,
      label: FIELD_LABEL[name],
      value: editableValue(readFields, name),
      hint: MONEY_FIELDS.has(name) ? "1234.56" : DATE_FIELDS.has(name) ? "AAAA-MM-DD" : null,
    })),
    canReevaluate: detail.newerPolicy || offer.needsReevaluation,
  };
}

/** Quién cobra, la referencia, el monto y el veredicto con la regla que lo decidió. */
function DetailHeader({ detail }: { readonly detail: InvoiceDetail }) {
  const { invoice, decision } = detail;
  const deciding = decision
    ? (decision.findings.find((f) => f.action === decision.verdict) ?? null)
    : null;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 space-y-1.5">
        <Link
          href="/pendientes"
          data-shortcut="volver"
          className="text-[13px] text-ink-2 hover:text-ink"
        >
          ← Pendientes
        </Link>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight text-ink sm:text-[30px]">
          {detail.payeeName ?? <span className="font-mono">{invoice.reference}</span>}
        </h1>
        {detail.payeeName ? (
          <p className="font-mono text-[13px] text-ink-3">{invoice.reference}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {decision?.amount ? (
          <span className="num font-mono text-[24px] font-semibold tracking-tight text-ink sm:text-[28px]">
            {formatMoney(decision.amount)}
          </span>
        ) : null}
        {decision ? (
          <VerdictChip
            focusable
            verdict={decision.verdict}
            rule={
              deciding
                ? {
                    code: deciding.code,
                    observed: deciding.observed,
                    threshold: deciding.threshold,
                  }
                : null
            }
            policyVersion={detail.policyVersion}
          />
        ) : (
          <VerdictChip verdict="en_proceso" />
        )}
      </div>
    </div>
  );
}

function Column({
  title,
  className = "",
  children,
}: {
  readonly title: string;
  /** Posición en la rejilla según el ancho de pantalla. */
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className={`min-w-0 space-y-4 ${className}`}>
      <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </section>
  );
}
