import { datasetReceiptKey } from "@/src/dataset/demo-seed";
import type { DatasetCase } from "@/src/dataset/schema";
import type { Database } from "@/src/db/client";
import {
  getCurrentPolicy,
  getLedgerPeriod,
  getOrganization,
  listDecisionsByInvoices,
  listExtractionsByInvoices,
  listInvoices,
} from "@/src/db/repositories";
import {
  money,
  periodKey,
  toUsd,
  type Currency,
  type Decision,
  type FindingCode,
  type Money,
  type OnFail,
  type Ulid,
} from "@/src/domain";
import { computeMetrics, type EvalRow, type Metrics, type Ratio } from "@/src/eval/metrics";
import { evalRowFor } from "@/src/eval/rows";

import { engineNow } from "./business-day";
import { UseCaseError } from "./errors";
import { describeInvoices, type InboxRow } from "./inbox";
import { LIST_LIMIT } from "./invoice-list";

/**
 * Métricas (docs/interfaz.md §5.5, docs/trazabilidad.md §3). Dos clases de números:
 *
 * - Los del set de regresión: autonomía, falsos "pagar", exactitud por campo, costo y tiempo.
 *   Se miden sobre las facturas del lote que tienen caso en el dataset, con la decisión del
 *   agente (no la de una persona después) y con el mismo `computeMetrics` y la misma fila
 *   que usa `npm run eval`. Así la pantalla y la evaluación dan lo mismo sobre la misma
 *   base (P-91). Una factura subida a mano no tiene veredicto esperado y no entra.
 * - Los de operación: escaladas esperando, presupuesto del periodo por moneda y reglas que
 *   más dispararon. Salen de todas las facturas, con la decisión vigente.
 *
 * Cada número lleva las facturas que lo componen (`drillInvoiceIds`), para que la pantalla
 * enlace a ellas y el conteo coincida (P-108).
 */

/** Una factura del lote medida contra su caso del dataset. */
export type MeasuredInvoice = {
  readonly invoiceId: Ulid;
  readonly row: EvalRow;
};

/** Escalada que espera a una persona, desde que el agente la decidió. */
export type WaitingInvoice = {
  readonly invoiceId: Ulid;
  readonly since: string;
};

export type BudgetSlice = {
  readonly currency: Currency;
  /** Lo pagado en la moneda de las facturas. */
  readonly paid: Money;
  /** Lo mismo convertido a la moneda del presupuesto: lo que comprometió. */
  readonly committed: Money;
  readonly invoiceIds: readonly Ulid[];
};

export type BudgetChart = {
  readonly periodKey: string;
  readonly limit: Money;
  readonly committed: Money;
  readonly byCurrency: readonly BudgetSlice[];
  /** Lo comprometido en el periodo que no sale de estas facturas: lo pagado antes de ellas. */
  readonly earlier: Money;
};

export type RuleCount = {
  readonly code: FindingCode;
  readonly action: OnFail;
  readonly invoiceIds: readonly Ulid[];
};

export type MetricsView = {
  readonly metrics: Metrics;
  readonly measured: readonly MeasuredInvoice[];
  /** Escaladas esperando, la más vieja primero. */
  readonly waiting: readonly WaitingInvoice[];
  readonly budget: BudgetChart;
  /** Reglas que dispararon en el periodo, la más frecuente primero. */
  readonly rules: readonly RuleCount[];
  /** Fila de pantalla de cada factura citada, para los detalles. */
  readonly invoices: ReadonlyMap<Ulid, InboxRow>;
};

export const METRIC_KEYS = [
  "autonomia",
  "falsos_pagar",
  "exactitud",
  "costo",
  "tiempo",
  "pendientes",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Cuántas reglas muestra el gráfico. */
export const TOP_RULES = 8;

export async function loadMetrics(
  db: Database,
  organizationId: Ulid,
  input: {
    /** Casos del dataset con su verdad esperada; vacío fuera de la demo. */
    readonly cases: readonly DatasetCase[];
    /** Día de negocio de un instante: en la demo es fijo, el del dataset. */
    readonly businessDateAt: (instant: Date) => string;
    readonly now: Date;
  },
): Promise<MetricsView> {
  const [organization, policy, invoices] = await Promise.all([
    getOrganization(db, organizationId),
    getCurrentPolicy(db, organizationId),
    listInvoices(db, organizationId, { limit: LIST_LIMIT }),
  ]);
  if (!policy) {
    throw new UseCaseError("policy_missing", "La empresa no tiene política vigente", {
      action: "Firma una política en Reglas",
    });
  }
  const ids = invoices.map((i) => i.id);
  const [decisions, extractions, described] = await Promise.all([
    listDecisionsByInvoices(db, organizationId, ids),
    listExtractionsByInvoices(db, organizationId, ids),
    describeInvoices(db, organizationId, invoices, input.now),
  ]);

  // Set de regresión: cada caso del lote por su llave de recepción.
  const caseByKey = new Map(input.cases.map((c) => [datasetReceiptKey(c), c]));
  const measured: MeasuredInvoice[] = [];
  for (const invoice of [...invoices].reverse()) {
    const c = caseByKey.get(invoice.receipt_key);
    // La decisión del agente al recibirla: lo que una persona aprueba, corrige o reevalúa
    // después apunta a una decisión anterior y no cuenta como acierto ni como error.
    const decision = decisions
      .get(invoice.id)
      ?.find((d) => d.actor.kind === "agente" && d.previous_decision_id === null);
    if (!c || !decision) continue;
    const extraction =
      extractions
        .get(invoice.id)
        ?.find((e) => e.record.extraction_hash === decision.extraction_hash) ?? null;
    const latency = Date.parse(decision.decided_at) - Date.parse(invoice.received_at);
    measured.push({
      invoiceId: invoice.id,
      row: evalRowFor(c, decision, extraction?.record.extraction ?? null, Math.max(0, latency)),
    });
  }

  // Operación: lo vigente de cada factura, en el periodo del presupuesto.
  const { budget } = policy.content.limits;
  const currentPeriod = periodKey(engineNow(input.businessDateAt(input.now)), budget.period);
  const inPeriod = (decision: Decision) =>
    periodKey(engineNow(input.businessDateAt(new Date(decision.decided_at))), budget.period) ===
    currentPeriod;

  const waiting: WaitingInvoice[] = [];
  const paid = new Map<Currency, { paid: number; committed: number; invoiceIds: Ulid[] }>();
  const rules = new Map<FindingCode, { action: OnFail; invoiceIds: Ulid[] }>();
  for (const invoice of invoices) {
    const current = decisions.get(invoice.id)?.[0];
    if (!current) continue;
    if (invoice.status === "esperando_aprobacion") {
      waiting.push({ invoiceId: invoice.id, since: current.decided_at });
    }
    if (!inPeriod(current)) continue;
    // Pagar sin orden es el modo de prueba: no comprometió presupuesto ni saldo.
    if (current.verdict === "pagar" && current.payment_order && current.amount) {
      const slice = paid.get(current.amount.currency) ?? { paid: 0, committed: 0, invoiceIds: [] };
      slice.paid += current.amount.amount;
      slice.committed += toUsd(current.amount, organization.fx).amount;
      slice.invoiceIds.push(invoice.id);
      paid.set(current.amount.currency, slice);
    }
    for (const finding of current.findings) {
      const entry = rules.get(finding.code) ?? { action: finding.action, invoiceIds: [] };
      if (!entry.invoiceIds.includes(invoice.id)) entry.invoiceIds.push(invoice.id);
      rules.set(finding.code, entry);
    }
  }
  waiting.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));

  const ledger = await getLedgerPeriod(db, organizationId, currentPeriod, budget.currency);
  const committed = ledger?.committed ?? 0;
  const byCurrency = [...paid]
    .map(([currency, slice]) => ({
      currency,
      paid: money(slice.paid, currency),
      committed: money(slice.committed, budget.currency),
      invoiceIds: slice.invoiceIds,
    }))
    .sort((a, b) => b.committed.amount - a.committed.amount);
  const fromInvoices = byCurrency.reduce((acc, s) => acc + s.committed.amount, 0);

  return {
    metrics: computeMetrics(measured.map((m) => m.row)),
    measured,
    waiting,
    budget: {
      periodKey: currentPeriod,
      limit: money(ledger?.limit ?? budget.amount, budget.currency),
      committed: money(committed, budget.currency),
      byCurrency,
      earlier: money(Math.max(0, committed - fromInvoices), budget.currency),
    },
    rules: [...rules]
      .map(([code, r]) => ({ code, action: r.action, invoiceIds: r.invoiceIds }))
      .sort((a, b) => b.invoiceIds.length - a.invoiceIds.length || (a.code < b.code ? -1 : 1))
      .slice(0, TOP_RULES),
    invoices: new Map(
      described.flatMap(({ invoice, row }) => (row ? [[invoice.id, row] as const] : [])),
    ),
  };
}

/** Qué número se abre: una tarjeta, una regla del gráfico o una moneda del presupuesto. */
export type Drill =
  | { readonly kind: "metric"; readonly key: MetricKey }
  | { readonly kind: "rule"; readonly code: FindingCode }
  | { readonly kind: "currency"; readonly currency: Currency };

/**
 * Las facturas que componen cada número, en el orden en que la pantalla las lista. El largo
 * de cada lista es el conteo que muestra la tarjeta o la barra (P-108).
 */
export function drillInvoiceIds(view: MetricsView, drill: Drill): Ulid[] {
  if (drill.kind === "rule") {
    return [...(view.rules.find((r) => r.code === drill.code)?.invoiceIds ?? [])];
  }
  if (drill.kind === "currency") {
    return [
      ...(view.budget.byCurrency.find((s) => s.currency === drill.currency)?.invoiceIds ?? []),
    ];
  }
  const all = view.measured;
  switch (drill.key) {
    case "autonomia":
    case "costo":
    case "tiempo":
      return all.map((m) => m.invoiceId);
    case "falsos_pagar": {
      const ids = new Set(view.metrics.false_pay);
      return all.filter((m) => ids.has(m.row.id)).map((m) => m.invoiceId);
    }
    case "exactitud":
      return all.filter((m) => m.row.fields.length > 0).map((m) => m.invoiceId);
    case "pendientes":
      return view.waiting.map((w) => w.invoiceId);
  }
}

/** Exactitud de todos los campos juntos: aciertos sobre campos medidos. */
export function overallFieldAccuracy(metrics: Metrics): Ratio {
  let hits = 0;
  let total = 0;
  for (const ratio of Object.values(metrics.field_accuracy)) {
    hits += ratio.hits;
    total += ratio.total;
  }
  return { hits, total, rate: total === 0 ? 1 : hits / total };
}
