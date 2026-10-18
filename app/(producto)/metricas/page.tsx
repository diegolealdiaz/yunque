import Link from "next/link";
import type { ReactNode } from "react";

import { loadExpectedCases } from "@/src/dataset/demo-seed";
import { ExtractedFieldNameSchema, formatMoney, money, type Money, type Ulid } from "@/src/domain";
import type { CaseGroup } from "@/src/eval/metrics";
import { duration, instant, percent, usdMicros } from "@/src/ui/format";
import { FIELD_LABEL, VERDICT_LABEL, VERDICT_PARTICIPLE, ruleTitle } from "@/src/ui/labels";
import {
  businessDateAt,
  drillInvoiceIds,
  loadMetrics,
  overallFieldAccuracy,
  type Drill,
  type MeasuredInvoice,
  type MetricsView,
} from "@/src/usecases";

import { DataTable, type Column } from "../../_components/data-table";
import { FigureRow } from "../../_components/figure-row";
import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";
import { VerdictChip } from "../../_components/verdict-chip";
import { appContext } from "../../_data/context";

import { BudgetChartCard, RulesChartCard } from "./charts";
import { drillFromParam, drillHref } from "./drill";

export const metadata = { title: "Métricas · Yunque" };

/**
 * Métricas (docs/interfaz.md §5.5): la franja del periodo, cómo decide el agente y dos
 * gráficos, nada más. Cada número es
 * un enlace a las facturas que lo componen, que se listan abajo en la misma pantalla: un
 * número sin origen no se puede defender. Los del set de regresión se calculan con el mismo
 * código que `npm run eval` (P-91).
 */

const metric = (key: Extract<Drill, { kind: "metric" }>["key"]) =>
  drillHref({ kind: "metric", key });

/** Campos leídos distinto de lo esperado, en palabras de pantalla. */
function mismatches(m: MeasuredInvoice): string {
  const wrong = m.row.fields.filter((f) => f.expected !== f.actual);
  if (wrong.length === 0) return "Todos coinciden";
  return wrong
    .map((f) => {
      const field = ExtractedFieldNameSchema.safeParse(f.field);
      return field.success ? FIELD_LABEL[field.data] : f.field;
    })
    .join(", ");
}

/** Un monto partido en cifra y moneda, para poner la cifra en grande. */
function splitMoney(m: Money): { readonly figure: string; readonly currency: string } {
  const text = formatMoney(m);
  const at = text.lastIndexOf(" ");
  return { figure: text.slice(0, at), currency: text.slice(at + 1) };
}

const invoicesWord = (n: number) => `${String(n)} ${n === 1 ? "factura" : "facturas"}`;

/**
 * Franja de arriba: lo pagado en el periodo en grande y, al lado, lo que se frenó, lo que
 * escaló, lo que espera a una persona y lo que queda del presupuesto.
 */
function Summary({ view, now }: { readonly view: MetricsView; readonly now: Date }) {
  const { outcomes, budget, waiting } = view;
  const paid = splitMoney(outcomes.pagar.total);
  const left = money(Math.max(0, budget.limit.amount - budget.committed.amount), "USD");
  const oldest = waiting[0];
  return (
    <section
      aria-label={`Resumen del periodo ${budget.periodKey}`}
      className="grid gap-6 border-b border-line pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:items-center lg:gap-10"
    >
      <Link href={drillHref({ kind: "verdict", verdict: "pagar" })} className="group block w-fit">
        <p className="font-mono text-[40px] leading-none font-medium tracking-tight text-brand sm:text-[52px]">
          {paid.figure}
          <span className="ml-2 text-[18px] font-normal text-ink-3">{paid.currency}</span>
        </p>
        <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2 group-hover:text-ink">
          <span aria-hidden="true" className="h-px w-5 bg-ink-3" />
          Pagado en {budget.periodKey} · {invoicesWord(outcomes.pagar.invoiceIds.length)}
        </p>
      </Link>
      <div className="grid gap-x-8 sm:grid-cols-2">
        <dl>
          <FigureRow
            label="Frenado"
            detail={`${invoicesWord(outcomes.frenar.invoiceIds.length)} que no se pagaron`}
            value={formatMoney(outcomes.frenar.total)}
            href={drillHref({ kind: "verdict", verdict: "frenar" })}
          />
          <FigureRow
            label="Escalado"
            detail={`${invoicesWord(outcomes.escalar.invoiceIds.length)} para una persona`}
            value={formatMoney(outcomes.escalar.total)}
            href={drillHref({ kind: "verdict", verdict: "escalar" })}
          />
        </dl>
        <dl className="sm:border-l sm:border-line sm:pl-8">
          <FigureRow
            label="Esperando a una persona"
            detail={
              oldest
                ? `La más antigua, hace ${duration(now.getTime() - Date.parse(oldest.since))}`
                : "Nada espera a una persona"
            }
            value={String(waiting.length)}
            href={oldest ? metric("pendientes") : null}
          />
          <FigureRow
            label="Presupuesto disponible"
            detail={`De ${formatMoney(budget.limit)} en el periodo`}
            value={formatMoney(left)}
            href={null}
          />
        </dl>
      </div>
    </section>
  );
}

/** Una cifra de la tarjeta del agente: nombre en mayúsculas, valor en mono y su detalle. */
function Stat({
  label,
  value,
  detail,
  href,
  tone = "text-ink",
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly href: string;
  readonly tone?: string;
}) {
  return (
    <Link href={href} className="group block min-w-0 py-1 lg:px-5 lg:first:pl-0">
      <span className="caps block">{label}</span>
      <span className={`mt-1.5 block font-mono text-[24px] leading-tight ${tone}`}>{value}</span>
      <span className="mt-1 block text-[12px] leading-snug text-ink-3 group-hover:text-ink-2">
        {detail}
      </span>
    </Link>
  );
}

const GROUPS: readonly {
  readonly group: CaseGroup;
  readonly label: string;
  readonly what: string;
}[] = [
  { group: "normal", label: "Normales", what: "Cobros legítimos: deberían pagarse solos." },
  {
    group: "trampa",
    label: "Trampas",
    what: "Duplicadas, cuenta distinta, sin presupuesto o sobre el umbral.",
  },
  {
    group: "adversarial",
    label: "Adversariales",
    what: "Documentos hechos para engañar al agente.",
  },
];

/**
 * Cómo decide el agente, medido sobre el lote con veredicto esperado: las cinco cifras del
 * set de regresión y el resultado por tipo de caso.
 */
function AgentCard({
  view,
  measuring,
}: {
  readonly view: MetricsView;
  readonly measuring: boolean;
}) {
  const { metrics } = view;
  const fields = overallFieldAccuracy(metrics);
  const accuracy = (field: string) => {
    const ratio = metrics.field_accuracy[field];
    return ratio ? percent(ratio.rate) : "—";
  };
  const falsePay = metrics.false_pay.length;
  return (
    <section aria-labelledby="agente-titulo" data-tour="metricas" className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="agente-titulo" className="text-[19px] font-semibold text-ink">
          Cómo decide el agente
        </h2>
        {metrics.total > 0 ? (
          <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-[12px] text-ink-2">
            {invoicesWord(metrics.total)} del lote ·{" "}
            <span className={falsePay === 0 ? "font-medium text-pay" : "font-medium text-hold"}>
              {String(falsePay)} falsos pagar
            </span>
          </span>
        ) : null}
        {metrics.total > 0 ? (
          <Link
            href={metric("autonomia")}
            className="ml-auto text-[13px] text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            Ver cada caso →
          </Link>
        ) : null}
      </div>

      {metrics.total === 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface-sunken px-4 py-4 text-[13px]">
          <p className="text-ink-2">
            {measuring
              ? "Aún no hay facturas medidas. Procesa las facturas de ejemplo y aquí verás cuántas decidió bien el agente, con cada caso."
              : "Solo se mide el lote con veredicto esperado."}
          </p>
          {measuring ? (
            <Link href="/facturas" className="h-8 btn-primary inline-flex items-center px-3">
              Ir a procesar
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-0 lg:divide-x lg:divide-line">
            <Stat
              label="Autonomía"
              value={percent(metrics.autonomy.rate)}
              detail={`${String(metrics.autonomy.hits)} de ${String(metrics.total)} correctas sin persona`}
              href={metric("autonomia")}
            />
            <Stat
              label="Falsos pagar"
              value={String(falsePay)}
              detail="Pagadas que debían frenarse o escalarse"
              href={metric("falsos_pagar")}
              tone={falsePay === 0 ? "text-pay" : "text-hold"}
            />
            <Stat
              label="Exactitud por campo"
              value={fields.total === 0 ? "—" : percent(fields.rate)}
              detail={`Monto ${accuracy("total")} · beneficiario ${accuracy("payee_name")}`}
              href={metric("exactitud")}
            />
            <Stat
              label="Costo por factura"
              value={usdMicros(metrics.cost.per_invoice_usd_micros)}
              detail={`${usdMicros(metrics.cost.total_usd_micros)} en total`}
              href={metric("costo")}
            />
            <Stat
              label="Tiempo medio"
              value={duration(metrics.latency.mean_ms)}
              detail={`La más lenta, ${duration(metrics.latency.max_ms)}`}
              href={metric("tiempo")}
            />
          </div>

          <table className="mt-6 w-full border-collapse text-[13px]">
            <caption className="sr-only">Resultado por tipo de caso</caption>
            <thead>
              <tr className="caps text-left">
                <th scope="col" className="pb-2 font-semibold">
                  Tipo de caso
                </th>
                <th scope="col" className="hidden pb-2 font-semibold md:table-cell">
                  Qué prueba
                </th>
                <th scope="col" className="pb-2 text-right font-semibold">
                  Acertó
                </th>
                <th scope="col" className="w-20 pb-2 text-right font-semibold">
                  Tasa
                </th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map(({ group, label, what }) => {
                const ratio = metrics.by_group[group];
                return (
                  <tr key={group} className="h-11 border-t border-line">
                    <th scope="row" className="text-left font-medium">
                      <Link
                        href={drillHref({ kind: "group", group })}
                        className="text-ink underline-offset-4 hover:underline"
                      >
                        {label}
                      </Link>
                    </th>
                    <td className="hidden text-ink-3 md:table-cell">{what}</td>
                    <td className="text-right font-mono text-ink-2">
                      {String(ratio.hits)} de {String(ratio.total)}
                    </td>
                    <td
                      className={`text-right font-mono ${ratio.hits === ratio.total ? "text-pay" : "text-escalate"}`}
                    >
                      {ratio.total === 0 ? "—" : percent(ratio.rate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

const DRILL_TITLE: Readonly<Record<Extract<Drill, { kind: "metric" }>["key"], string>> = {
  autonomia: "Autonomía: lo que decidió el agente contra lo esperado",
  falsos_pagar: "Falsos pagar",
  exactitud: "Exactitud por campo: campos leídos distinto de lo esperado",
  costo: "Costo por factura",
  tiempo: "Tiempo de decisión",
  pendientes: "Escaladas que esperan, la más antigua primero",
};

function drillTitle(drill: Drill): string {
  if (drill.kind === "metric") return DRILL_TITLE[drill.key];
  if (drill.kind === "rule") return `Regla: ${ruleTitle(drill.code)}`;
  if (drill.kind === "verdict") return `${VERDICT_PARTICIPLE[drill.verdict]} en el periodo`;
  if (drill.kind === "group") {
    return `${GROUPS.find((g) => g.group === drill.group)?.label ?? drill.group}: lo que decidió el agente contra lo esperado`;
  }
  return `Pagado en ${drill.currency}`;
}

type ExtraColumns = {
  readonly columns: readonly Column[];
  readonly cells: (id: Ulid) => readonly ReactNode[];
};

/** Columnas propias de cada número, además de referencia, beneficiario y veredicto vigente. */
function extraColumns(drill: Drill, view: MetricsView, timeZone: string): ExtraColumns {
  const measured = new Map(view.measured.map((m) => [m.invoiceId, m]));
  const waiting = new Map(view.waiting.map((w) => [w.invoiceId, w]));
  const verdicts: ExtraColumns = {
    columns: [
      { header: "Esperado", width: "7rem" },
      { header: "Agente", width: "7rem" },
      { header: "Resultado", width: "7rem" },
    ],
    cells: (id: Ulid) => {
      const m = measured.get(id);
      if (!m) return ["", "", ""];
      const hit = m.row.actual.verdict === m.row.expected.verdict;
      return [
        VERDICT_LABEL[m.row.expected.verdict],
        VERDICT_LABEL[m.row.actual.verdict],
        <span key="h" className={hit ? "text-ink-2" : "font-medium text-hold"}>
          {hit ? "Acierto" : "Error"}
        </span>,
      ];
    },
  };
  if (drill.kind === "group") return verdicts;
  if (drill.kind === "metric") {
    switch (drill.key) {
      case "autonomia":
      case "falsos_pagar":
        return verdicts;
      case "exactitud":
        return {
          columns: [{ header: "Campos distintos" }],
          cells: (id) => {
            const m = measured.get(id);
            return [m ? mismatches(m) : ""];
          },
        };
      case "costo":
        return {
          columns: [{ header: "Costo", align: "right", width: "9rem" }],
          cells: (id) => {
            const m = measured.get(id);
            return [m ? <span className="font-mono">{usdMicros(m.row.cost_usd_micros)}</span> : ""];
          },
        };
      case "tiempo":
        return {
          columns: [{ header: "Tiempo", align: "right", width: "7rem" }],
          cells: (id) => {
            const m = measured.get(id);
            return [m ? <span className="font-mono">{duration(m.row.latency_ms)}</span> : ""];
          },
        };
      case "pendientes":
        return {
          columns: [{ header: "Espera desde", width: "9rem" }],
          cells: (id) => {
            const w = waiting.get(id);
            return [w ? instant(w.since, timeZone) : ""];
          },
        };
    }
  }
  return {
    columns: [{ header: "Monto", align: "right", width: "11rem" }],
    cells: (id) => {
      const amount = view.invoices.get(id)?.amount;
      return [amount ? <span className="font-mono">{formatMoney(amount)}</span> : ""];
    },
  };
}

function DrillTable({
  drill,
  view,
  timeZone,
}: {
  readonly drill: Drill;
  readonly view: MetricsView;
  readonly timeZone: string;
}) {
  const ids = drillInvoiceIds(view, drill);
  const extra = extraColumns(drill, view, timeZone);
  return (
    <section id="detalle" aria-labelledby="detalle-titulo" className="space-y-3 scroll-mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="detalle-titulo" className="text-[16px] font-semibold text-ink">
          {drillTitle(drill)}
        </h2>
        <p className="text-[13px] text-ink-2">
          {ids.length} {ids.length === 1 ? "factura" : "facturas"}
        </p>
      </div>
      <DataTable
        caption={drillTitle(drill)}
        columns={[
          { header: "Referencia", width: "9rem" },
          { header: "Beneficiario" },
          ...extra.columns,
          { header: "Veredicto vigente", width: "20rem" },
        ]}
        rows={ids.map((id) => {
          const current = view.invoices.get(id);
          return {
            key: id,
            href: `/facturas/${id}`,
            cells: [
              <span key="r" className="font-mono text-[12px]">
                {current?.reference ?? id}
              </span>,
              <span key="p" className="font-medium">
                {current?.payeeName ?? <span className="font-normal text-ink-3">sin leer</span>}
              </span>,
              ...extra.cells(id).map((cell, i) => (
                <span key={`x${String(i)}`} className="text-ink-2">
                  {cell}
                </span>
              )),
              current ? (
                <VerdictChip
                  key="v"
                  verdict={current.verdict}
                  rule={current.rule}
                  policyVersion={current.policyVersion}
                />
              ) : (
                <VerdictChip key="v" verdict="en_proceso" />
              ),
            ],
          };
        })}
        empty={
          <EmptyState
            title={
              drill.kind === "metric" && drill.key === "falsos_pagar"
                ? "Ninguna factura se pagó sin deber pagarse."
                : "Ninguna factura en este número."
            }
          />
        }
      />
    </section>
  );
}

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const drill = drillFromParam((await searchParams)["ver"]);
  const { config, db, organization } = await appContext();
  const demo = { demo: config.demo.enabled, timeZone: config.displayTimeZone };
  const now = new Date();
  const view = await loadMetrics(db, organization.id, {
    cases: config.demo.enabled ? await loadExpectedCases() : [],
    businessDateAt: (instantAt) => businessDateAt(demo, instantAt),
    now,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Métricas"
        meta={
          <span>
            {view.metrics.total > 0
              ? `Medido sobre ${String(view.metrics.total)} facturas del lote`
              : "Sin facturas medidas"}{" "}
            · periodo {view.budget.periodKey}
          </span>
        }
      />
      <Summary view={view} now={now} />
      <AgentCard view={view} measuring={config.demo.enabled} />
      <div className="grid gap-4 lg:grid-cols-2">
        <BudgetChartCard budget={view.budget} />
        <RulesChartCard rules={view.rules} periodKey={view.budget.periodKey} />
      </div>
      {drill ? <DrillTable drill={drill} view={view} timeZone={config.displayTimeZone} /> : null}
    </div>
  );
}
