import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DbError } from "@/src/db/errors";
import { formatMoney, isSupportedCurrency, money } from "@/src/domain";
import { calendarDate, usdMicros } from "@/src/ui/format";
import { FIELD_LABEL, ruleTitle } from "@/src/ui/labels";
import { timelineLines } from "@/src/ui/timeline";
import {
  loadInvoiceDetail,
  type DetailField,
  type InvoiceDetail,
  type RuleTrace,
} from "@/src/usecases";

import { ApprovalChecklist } from "../../../_components/approval-checklist";
import { ConfidenceDot } from "../../../_components/confidence-dot";
import {
  DocumentViewer,
  EvidenceProvider,
  EvidenceTarget,
} from "../../../_components/document-viewer";
import { CheckIcon, StopIcon } from "../../../_components/icons";
import { Timeline } from "../../../_components/timeline";
import { VerdictChip } from "../../../_components/verdict-chip";
import { appContext } from "../../../_data/context";
import { fileStorage } from "../../../_data/storage";

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

function Column({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 space-y-4">
      <h2 className="text-[12px] font-semibold tracking-wide text-ink-2 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function SubTitle({ children }: { readonly children: ReactNode }) {
  return <h3 className="text-[12px] font-medium tracking-wide text-ink-3 uppercase">{children}</h3>;
}

function RuleRow({ rule }: { readonly rule: RuleTrace }) {
  const failed = rule.outcome === "fail" || rule.outcome === "error";
  return (
    <li className="grid grid-cols-[1.25rem_1fr] gap-x-2 py-1 text-[13px]">
      <span aria-hidden="true" className={failed ? "text-hold-solid" : "text-ink-3"}>
        {failed ? <StopIcon /> : <CheckIcon />}
      </span>
      <span>
        <span className="font-mono text-[12px] text-ink">{rule.code}</span>{" "}
        <span className="text-ink-2">· {ruleTitle(rule.code)}</span>
        {rule.outcome === "skipped" ? <span className="text-ink-3"> · no aplicó</span> : null}
        {rule.finding ? (
          <span className="block text-[12px] text-ink-2">
            observado {rule.finding.observed} · umbral {rule.finding.threshold}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function DecisionPanel({ detail }: { readonly detail: InvoiceDetail }) {
  const { decision, invoice } = detail;
  if (!decision) {
    return <p className="text-[13px] text-ink-2">La factura todavía no tiene decisión.</p>;
  }
  if (invoice.status === "esperando_aprobacion") {
    return (
      <ApprovalChecklist
        items={detail.checklist}
        signature={detail.signatureSummary ?? "sin contenido para firmar"}
        disabledReason="La aprobación firmada se habilita en el siguiente paso del producto."
      />
    );
  }
  if (decision.verdict === "pagar") {
    const order = decision.payment_order;
    return (
      <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-[13px]">
        <p className="font-medium text-pay">Pagada por el agente dentro de las reglas.</p>
        {order ? (
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
        <p className="text-ink-2">
          Hay una versión de política más nueva: podrás reevaluarla con ella.
        </p>
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
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_19rem]">
          <Column title="Documento">
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

          <Column title="Lo que leyó y decidió">
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
                      </span>
                      <ConfidenceDot confidence={field.confidence} minimum={detail.minConfidence} />
                    </span>
                  </EvidenceTarget>
                ))
              )}
            </div>

            <div>
              <SubTitle>Reglas</SubTitle>
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

          <Column title="Tu decisión">
            <DecisionPanel detail={detail} />
            <div>
              <SubTitle>Línea de tiempo</SubTitle>
              <div className="mt-2">
                <Timeline entries={timelineLines(detail.timeline)} />
              </div>
            </div>
          </Column>
        </div>
      </EvidenceProvider>
    </div>
  );
}
