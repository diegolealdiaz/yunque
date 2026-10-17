import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DbError } from "@/src/db/errors";
import { formatMoney, isSupportedCurrency, money } from "@/src/domain";
import { getCurrentPolicy } from "@/src/db/repositories";
import { APPROVER_COOKIE, verifyApprover } from "@/src/session";
import { calendarDate, instant, usdMicros } from "@/src/ui/format";
import { FIELD_LABEL, ruleTitle } from "@/src/ui/labels";
import { timelineLines } from "@/src/ui/timeline";
import { EXTRACTED_FIELD_NAMES } from "@/src/domain";
import {
  approvalOffer,
  editableValue,
  loadInvoiceDetail,
  type DetailField,
  type InvoiceDetail,
  type RuleTrace,
} from "@/src/usecases";

import { ConfidenceDot } from "../../../_components/confidence-dot";
import {
  DocumentViewer,
  EvidenceProvider,
  EvidenceTarget,
} from "../../../_components/document-viewer";
import { AlertIcon, CheckIcon, StopIcon } from "../../../_components/icons";
import { Timeline } from "../../../_components/timeline";
import { VerdictChip } from "../../../_components/verdict-chip";
import { appContext } from "../../../_data/context";
import { fileStorage } from "../../../_data/storage";

import { ReevaluateButton } from "./correction-form";
import { ResolutionPanel } from "./resolution-panel";

export const metadata = { title: "Factura · Yunque" };

/**
 * Detalle de una decisión (docs/interfaz.md §5.2). Tres columnas, una pregunta cada una:
 * qué dice el documento, qué leyó y decidió el agente, y qué hace la persona. Todo lo que
 * viene del documento se pinta como texto; la imagen la sirve el servidor, nunca el PDF.
 */

const MONEY_FIELDS = new Set(["subtotal", "taxes", "total"]);
const DATE_FIELDS = new Set(["issue_date", "due_date"]);

/** Valor de un campo para la pantalla: montos con su moneda, fechas absolutas. */
function displayValue(field: DetailField, currency: string | null): string {
  if (
    typeof field.value === "number" &&
    MONEY_FIELDS.has(field.name) &&
    currency &&
    isSupportedCurrency(currency)
  ) {
    return formatMoney(money(field.value, currency));
  }
  if (typeof field.value === "string" && DATE_FIELDS.has(field.name))
    return calendarDate(field.value);
  return String(field.value);
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
      <h2 className="text-[12px] font-semibold tracking-wide text-ink-2 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function SubTitle({ children }: { readonly children: ReactNode }) {
  return <h3 className="text-[12px] font-medium tracking-wide text-ink-3 uppercase">{children}</h3>;
}

/** Cómo se ve una regla que falló, según lo que hace: frenar o escalar. Siempre con texto. */
const FAILED_STYLE = {
  frenar: { Icon: StopIcon, className: "text-hold-solid", label: "falló · frena" },
  escalar: { Icon: AlertIcon, className: "text-escalate-solid", label: "falló · escala" },
} as const;

function RuleRow({ rule }: { readonly rule: RuleTrace }) {
  const failed = rule.outcome === "fail" || rule.outcome === "error";
  // Una regla que no se pudo evaluar frena (rule_error): es lo más estricto.
  const style = failed ? FAILED_STYLE[rule.finding?.action ?? "frenar"] : null;
  const Icon = style?.Icon ?? CheckIcon;
  const status = style?.label ?? (rule.outcome === "skipped" ? "no aplicó" : "pasó");
  return (
    <li className="grid grid-cols-[1.25rem_1fr] gap-x-2 py-1 text-[13px]">
      <span aria-hidden="true" className={style?.className ?? "text-ink-3"}>
        <Icon />
      </span>
      <span>
        <span className="font-mono text-[12px] text-ink">{rule.code}</span>{" "}
        <span className="text-ink-2">· {ruleTitle(rule.code)}</span>
        <span className={style ? `font-medium ${style.className}` : "text-ink-3"}> · {status}</span>
        {rule.finding ? (
          <span className="block text-[12px] text-ink-2">
            observado {rule.finding.observed} · umbral {rule.finding.threshold}
          </span>
        ) : null}
      </span>
    </li>
  );
}

type Resolution = Parameters<typeof ResolutionPanel>[0];

function DecisionPanel({
  detail,
  resolution,
  approver,
}: {
  readonly detail: InvoiceDetail;
  readonly resolution: Resolution | null;
  /** Aprobador elegido (cookie verificada), o null. */
  readonly approver: string | null;
}) {
  const { decision, invoice, approval } = detail;
  if (!decision) {
    return <p className="text-[13px] text-ink-2">La factura todavía no tiene decisión.</p>;
  }
  if (invoice.status === "esperando_aprobacion" && resolution) {
    return <ResolutionPanel {...resolution} />;
  }
  if (invoice.status === "rechazada" && approval) {
    return (
      <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-[13px]">
        <p className="font-medium text-hold">
          Rechazada por {approval.approver} · {instant(approval.created_at)}
        </p>
        <p className="text-ink-2">Motivo: {approval.reason}</p>
        <p className="text-ink-3">El rechazo es final: la factura no se pagará.</p>
      </div>
    );
  }
  if (decision.verdict === "pagar") {
    const order = decision.payment_order;
    return (
      <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-[13px]">
        <p className="font-medium text-pay">
          {decision.actor.kind === "humano"
            ? `Aprobada por ${decision.actor.name} · ${instant(decision.decided_at)}`
            : "Pagada por el agente dentro de las reglas."}
        </p>
        {order ? (
          <>
            <dl className="space-y-1">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Orden</dt>
                <dd className="font-medium">preparada, no ejecutada</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">A</dt>
                <dd>{order.beneficiary_name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Cuenta</dt>
                <dd className="font-mono">
                  {order.account_masked} · {order.rail}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Monto</dt>
                <dd className="font-mono">{formatMoney(order.amount)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Programada</dt>
                <dd>{calendarDate(order.scheduled_for)}</dd>
              </div>
            </dl>
            {/* Descarga de archivo, no navegación: un enlace simple con `download`. */}
            <a
              href={`/facturas/${decision.invoice_id}/orden`}
              download
              className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium text-ink"
            >
              Descargar orden en PDF
            </a>
          </>
        ) : (
          <p className="text-ink-2">
            Modo de prueba: decidida sin preparar orden ni comprometer presupuesto.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-[13px]">
      <p className="font-medium text-hold">El agente la frenó.</p>
      <p className="text-ink-2">
        No se paga. Para reconsiderarla hay que corregir la causa y reprocesar.
      </p>
      {detail.newerPolicy ? (
        <>
          <p className="text-ink-2">
            Hay una versión de política más nueva: se puede reevaluar con ella.
          </p>
          <ReevaluateButton
            invoiceId={invoice.id}
            disabledReason={approver === null ? "Elige quién resuelve para poder reevaluar." : null}
          />
        </>
      ) : null}
    </div>
  );
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, organization } = await appContext();
  const detail = await loadInvoiceDetail(db, fileStorage(), organization.id, id).catch(
    (error: unknown) => {
      if (error instanceof DbError && error.code === "not_found") notFound();
      throw error;
    },
  );
  const { invoice, decision } = detail;
  const { config } = await appContext();
  const offer =
    invoice.status === "esperando_aprobacion"
      ? await approvalOffer(
          { db, signingSecret: config.secrets.approvalSigning, now: () => new Date() },
          organization.id,
          invoice.id,
        )
      : null;
  const policy = offer ? await getCurrentPolicy(db, organization.id) : null;
  const approver = verifyApprover(
    (await cookies()).get(APPROVER_COOKIE)?.value,
    config.secrets.session,
  );
  const readFields =
    detail.extraction?.extraction.kind === "invoice" ? detail.extraction.extraction.fields : null;
  const resolution: Resolution | null = offer
    ? {
        invoiceId: invoice.id,
        payload: JSON.stringify(offer.payload),
        signature: offer.signature,
        signatureSummary: detail.signatureSummary ?? "sin contenido para firmar",
        checklist: offer.checklist,
        blocked: offer.blocked,
        approvers: policy?.content.protected.approvers ?? [],
        approver,
        editable: EXTRACTED_FIELD_NAMES.map((name) => ({
          name,
          label: FIELD_LABEL[name],
          value: editableValue(readFields, name),
          hint: MONEY_FIELDS.has(name) ? "1234.56" : DATE_FIELDS.has(name) ? "AAAA-MM-DD" : null,
        })),
        canReevaluate: detail.newerPolicy || offer.needsReevaluation,
      }
    : null;
  const currency =
    detail.extraction?.extraction.kind === "invoice"
      ? detail.extraction.extraction.fields.currency.value
      : null;
  const failed = detail.rules.filter((r) => r.outcome === "fail" || r.outcome === "error");
  const others = detail.rules.filter((r) => r.outcome !== "fail" && r.outcome !== "error");
  const deciding = decision
    ? (decision.findings.find((f) => f.action === decision.verdict) ?? null)
    : null;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/pendientes"
            data-shortcut="volver"
            className="text-[13px] text-ink-2 hover:text-ink"
          >
            ← Pendientes
          </Link>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            <span className="font-mono">{invoice.reference}</span>
            {detail.payeeName ? <span> · {detail.payeeName}</span> : null}
            {decision?.amount ? (
              <span className="font-mono"> · {formatMoney(decision.amount)}</span>
            ) : null}
          </h1>
        </div>
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
            title="Lo que leyó y decidió"
            className="lg:col-start-2 lg:row-start-2 xl:row-start-1"
          >
            <div className="space-y-1">
              <SubTitle>Campos</SubTitle>
              {detail.fields.length === 0 ? (
                <p className="text-[13px] text-ink-2">
                  El agente no pudo leer campos de este documento.
                </p>
              ) : (
                detail.fields.map((field) => (
                  <EvidenceTarget key={field.name} id={field.name}>
                    <span className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
                      <span className="text-ink-2">{FIELD_LABEL[field.name]}</span>
                      <span className="truncate font-mono text-ink">
                        {displayValue(field, currency)}
                        {field.source === "humano" ? (
                          <span className="ml-1.5 rounded-sm border border-line-strong px-1 font-sans text-[11px] text-ink-2">
                            a mano
                          </span>
                        ) : null}
                      </span>
                      <ConfidenceDot confidence={field.confidence} minimum={detail.minConfidence} />
                    </span>
                  </EvidenceTarget>
                ))
              )}
            </div>

            <div>
              <SubTitle>
                {detail.rulesFromEscalation ? "Reglas de la escalada aprobada" : "Reglas"}
              </SubTitle>
              <ul className="mt-1">
                {failed.map((rule) => (
                  <RuleRow key={rule.code} rule={rule} />
                ))}
              </ul>
              {others.length > 0 ? (
                <details className="mt-1 text-[13px]">
                  <summary className="cursor-pointer text-ink-2">
                    {others.length} reglas más, en orden
                  </summary>
                  <ul>
                    {others.map((rule) => (
                      <RuleRow key={rule.code} rule={rule} />
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>

            {decision ? (
              <div>
                <SubTitle>Explicación</SubTitle>
                <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-line text-ink">
                  {decision.explanation}
                </p>
              </div>
            ) : null}

            {decision ? (
              <p className="text-[12px] text-ink-3">
                Costo de lectura: {usdMicros(decision.cost_usd_micros)} · política v
                {detail.policyVersion ?? "?"}
              </p>
            ) : null}
          </Column>

          <Column title="Tu decisión" className="lg:col-start-2 lg:row-start-1 xl:col-start-3">
            <DecisionPanel detail={detail} resolution={resolution} approver={approver} />
            <div>
              <SubTitle>Línea de tiempo</SubTitle>
              <div className="mt-2">
                <Timeline entries={timelineLines(detail.timeline)} />
              </div>
              <Link
                href={`/bitacora?factura=${detail.invoice.reference}`}
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
