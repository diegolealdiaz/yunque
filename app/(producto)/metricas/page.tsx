import type { ReactNode } from "react";

import { loadExpectedCases } from "@/src/dataset/demo-seed";
import { ExtractedFieldNameSchema, formatMoney, type Ulid } from "@/src/domain";
import { duration, instant, percent, usdMicros } from "@/src/ui/format";
import { FIELD_LABEL, VERDICT_LABEL, ruleTitle } from "@/src/ui/labels";
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
import { PageHeader } from "../../_components/page-header";
import { StatCard } from "../../_components/stat-card";
import { EmptyState } from "../../_components/states";
import { VerdictChip } from "../../_components/verdict-chip";
import { appContext } from "../../_data/context";

import { BudgetChartCard, RulesChartCard } from "./charts";
import { drillFromParam, drillHref } from "./drill";

export const metadata = { title: "Métricas · Yunque" };

/**
 * Métricas (docs/interfaz.md §5.5): seis tarjetas y dos gráficos, nada más. Cada número es
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

function Cards({
  view,
  measuring,
  now,
}: {
  readonly view: MetricsView;
  readonly measuring: boolean;
  readonly now: Date;
}) {
  const { metrics, waiting } = view;
  const none = metrics.total === 0;
  const unmeasured = measuring
    ? "Procesa el periodo para medir"
    : "Solo se mide el lote con veredicto esperado";
  const fields = overallFieldAccuracy(metrics);
  const accuracy = (field: string) => {
    const ratio = metrics.field_accuracy[field];
    return ratio ? percent(ratio.rate) : "—";
  };
  const oldest = waiting[0];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        label="Autonomía"
        value={none ? "—" : percent(metrics.autonomy.rate)}
        detail={
          none
            ? unmeasured
            : `${String(metrics.autonomy.hits)} de ${String(metrics.total)} correctas sin persona · escala ${percent(metrics.escalation.rate)}`
        }
        href={none ? null : metric("autonomia")}
      />
      <StatCard
        label="Falsos pagar"
        value={none ? "—" : String(metrics.false_pay.length)}
        detail={none ? unmeasured : "Pagadas que debían frenarse o escalarse"}
        href={none ? null : metric("falsos_pagar")}
        emphasis
      />
      <StatCard
        label="Exactitud por campo"
        value={none || fields.total === 0 ? "—" : percent(fields.rate)}
        detail={
          none ? unmeasured : `Monto ${accuracy("total")} · beneficiario ${accuracy("payee_name")}`
        }
        href={none ? null : metric("exactitud")}
      />
      <StatCard
        label="Costo por factura"
        value={none ? "—" : usdMicros(metrics.cost.per_invoice_usd_micros)}
        detail={
          none
            ? unmeasured
            : `${usdMicros(metrics.cost.total_usd_micros)} en ${String(metrics.total)} facturas`
        }
        href={none ? null : metric("costo")}
      />
      <StatCard
        label="Tiempo medio de decisión"
        value={none ? "—" : duration(metrics.latency.mean_ms)}
        detail={none ? unmeasured : `La más lenta ${duration(metrics.latency.max_ms)}`}
        href={none ? null : metric("tiempo")}
      />
      <StatCard
        label="Pendiente más antiguo"
        value={oldest ? duration(now.getTime() - Date.parse(oldest.since)) : "Ninguno"}
        detail={
          oldest
            ? `${String(waiting.length)} ${waiting.length === 1 ? "escalada espera" : "escaladas esperan"} a una persona`
            : "Nada espera a una persona"
        }
        href={oldest ? metric("pendientes") : null}
      />
    </div>
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
  return `Pagado en ${drill.currency}`;
}

/** Columnas propias de cada número, además de referencia, beneficiario y veredicto vigente. */
function extraColumns(
  drill: Drill,
  view: MetricsView,
): {
  readonly columns: readonly Column[];
  readonly cells: (id: Ulid) => readonly ReactNode[];
} {
  const measured = new Map(view.measured.map((m) => [m.invoiceId, m]));
  const waiting = new Map(view.waiting.map((w) => [w.invoiceId, w]));
  if (drill.kind === "metric") {
    switch (drill.key) {
      case "autonomia":
      case "falsos_pagar":
        return {
          columns: [
            { header: "Esperado", width: "7rem" },
            { header: "Agente", width: "7rem" },
            { header: "Resultado", width: "7rem" },
          ],
          cells: (id) => {
            const m = measured.get(id);
            if (!m) return ["", "", ""];
            const hit = m.row.actual.verdict === m.row.expected.verdict;
            return [
              VERDICT_LABEL[m.row.expected.verdict],
              VERDICT_LABEL[m.row.actual.verdict],
              <span key="h" className={hit ? "text-pay" : "font-medium text-hold"}>
                {hit ? "Acierto" : "Error"}
              </span>,
            ];
          },
        };
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
            return [w ? instant(w.since) : ""];
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

function DrillTable({ drill, view }: { readonly drill: Drill; readonly view: MetricsView }) {
  const ids = drillInvoiceIds(view, drill);
  const extra = extraColumns(drill, view);
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
          { header: "Veredicto vigente", width: "16rem" },
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
    <div className="max-w-7xl space-y-6">
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
      <Cards view={view} measuring={config.demo.enabled} now={now} />
      <div className="grid gap-4 lg:grid-cols-2">
        <BudgetChartCard budget={view.budget} />
        <RulesChartCard rules={view.rules} periodKey={view.budget.periodKey} />
      </div>
      {drill ? <DrillTable drill={drill} view={view} /> : null}
    </div>
  );
}
