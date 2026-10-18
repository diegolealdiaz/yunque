import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { datasetReceiptKey } from "@/src/dataset/demo-seed";
import * as repos from "@/src/db/repositories";
import { policyEditToYaml, type Policy } from "@/src/domain";
import { runEvaluation, type EvaluationResult } from "@/src/eval";
import {
  METRIC_KEYS,
  approvePolicyProposal,
  businessDateAt,
  candidateFromYaml,
  drillInvoiceIds,
  loadMetrics,
  overallFieldAccuracy,
  processInvoice,
  submitPolicy,
  type MetricsView,
} from "@/src/usecases";

import { datasetCases, openPipeline, type Pipeline } from "./helpers";

/**
 * P-91 y P-108: la pantalla de Métricas da los mismos números que `npm run eval` sobre el
 * mismo dataset, mide la decisión del agente y no la de una persona después, y cada número
 * se abre en exactamente las facturas que lo componen.
 */

const TODAY = "2026-10-17";
let p: Pipeline;
let evaluation: EvaluationResult;
const cases = (async () => (await datasetCases()).map((f) => f.case))();

async function metrics(): Promise<MetricsView> {
  return loadMetrics(p.t.db, p.organizationId, {
    cases: await cases,
    businessDateAt: (instant) =>
      businessDateAt({ demo: true, timeZone: "America/Bogota" }, instant),
    now: p.t.now(),
  });
}

beforeAll(async () => {
  p = await openPipeline();
  for (const f of await datasetCases()) {
    p.client.next = f.modelOutput;
    await processInvoice(p.deps, {
      ...p.input(f.bytes, datasetReceiptKey(f.case), f.fileName),
      channel: "batch",
    });
  }
  evaluation = await runEvaluation({ source: "ideal" });
}, 300_000);

afterAll(async () => {
  await p.close();
});

describe("Métricas contra la evaluación (P-91)", () => {
  it("autonomía, falsos pagar, reglas, explicabilidad y exactitud coinciden con eval", async () => {
    const screen = (await metrics()).metrics;
    const expected = evaluation.metrics;
    expect(screen.total).toBe(expected.total);
    expect(screen.autonomy).toEqual(expected.autonomy);
    expect(screen.false_pay).toEqual(expected.false_pay);
    expect(screen.false_pay).toHaveLength(0);
    expect(screen.rule_match).toEqual(expected.rule_match);
    expect(screen.escalation).toEqual(expected.escalation);
    expect(screen.explainability).toEqual(expected.explainability);
    expect(screen.field_accuracy).toEqual(expected.field_accuracy);
    expect(screen.confusion).toEqual(expected.confusion);
    expect(screen.by_group).toEqual(expected.by_group);
  });

  it("una persona que cambia el veredicto después no cambia la autonomía del agente", async () => {
    const before = await metrics();
    const current = await repos.getCurrentPolicy(p.t.db, p.organizationId);
    if (!current) throw new Error("sin política");
    // Subir el umbral al límite por pago hace que el replay pague lo que escalaba por umbral.
    const raised: Policy = candidateFromYaml(
      current.content,
      policyEditToYaml(current.content).replace(
        /approval_threshold:\n(\s+)amount: \d+/,
        `approval_threshold:\n$1amount: ${String(current.content.limits.per_payment.amount)}`,
      ),
    );
    const decideDeps = {
      db: p.t.db,
      newId: p.t.newId,
      now: p.t.now,
      timeZone: "America/Bogota",
      businessDate: TODAY,
    };
    // Subir el umbral afloja la política: lo propone una persona y lo aprueba otra.
    const submitted = await submitPolicy(decideDeps, {
      organizationId: p.organizationId,
      candidate: raised,
      baseVersion: current.version,
      signedBy: "Diego Leal",
      note: null,
    });
    // Sin doble firma se guarda directo; con ella, la aprueba otra persona.
    const approved =
      submitted.kind === "guardada"
        ? submitted
        : await approvePolicyProposal(decideDeps, {
            organizationId: p.organizationId,
            proposalId: submitted.proposal.id,
            approver: "Ana Torres",
          });
    if (approved.kind === "controles") throw new Error("se esperaba una versión de la política");
    const replay = approved;
    expect(replay.changed).toBeGreaterThan(0);
    const after = await metrics();
    expect(after.metrics.autonomy).toEqual(before.metrics.autonomy);
    expect(after.metrics.false_pay).toEqual(before.metrics.false_pay);
    // Lo operativo sí sigue a lo vigente: hay menos escaladas esperando.
    expect(after.waiting.length).toBeLessThan(before.waiting.length);
  });
});

describe("cada número se abre en sus facturas (P-108)", () => {
  it("el conteo de cada tarjeta es el largo de su lista", async () => {
    const view = await metrics();
    const count = (key: (typeof METRIC_KEYS)[number]) =>
      drillInvoiceIds(view, { kind: "metric", key }).length;
    expect(count("autonomia")).toBe(view.metrics.autonomy.total);
    expect(count("falsos_pagar")).toBe(view.metrics.false_pay.length);
    // Costo: el gasto real del periodo, solo las facturas cuya lectura costó. Aquí todas las
    // del lote pasan por el modelo simulado, así que el total coincide con el de la evaluación.
    expect(count("costo")).toBe(view.spend.byInvoice.size);
    expect(view.spend.byInvoice.size).toBeGreaterThan(0);
    expect(view.spend.totalUsdMicros).toBe(view.metrics.cost.total_usd_micros);
    expect(count("tiempo")).toBe(view.metrics.total);
    expect(count("pendientes")).toBe(view.waiting.length);
    // Exactitud: las facturas con campos medidos; el documento que no es factura no entra.
    const withFields = view.measured.filter((m) => m.row.fields.length > 0);
    expect(count("exactitud")).toBe(withFields.length);
    expect(overallFieldAccuracy(view.metrics).total).toBe(
      withFields.reduce((acc, m) => acc + m.row.fields.length, 0),
    );
  });

  it("cada veredicto del periodo y cada tipo de caso se abre en sus facturas", async () => {
    const view = await metrics();
    for (const verdict of ["pagar", "frenar", "escalar"] as const) {
      const ids = drillInvoiceIds(view, { kind: "verdict", verdict });
      expect(ids).toHaveLength(view.outcomes[verdict].invoiceIds.length);
      for (const id of ids) {
        const decision = await repos.getLatestDecision(p.t.db, p.organizationId, id);
        expect(decision?.verdict).toBe(verdict);
      }
    }
    expect(view.outcomes.frenar.invoiceIds.length).toBeGreaterThan(0);
    expect(view.outcomes.pagar.total.currency).toBe("USD");
    for (const group of ["normal", "trampa", "adversarial"] as const) {
      const ids = drillInvoiceIds(view, { kind: "group", group });
      expect(ids).toHaveLength(view.metrics.by_group[group].total);
    }
  });

  it("cada barra de regla y de moneda lista facturas que de verdad la componen", async () => {
    const view = await metrics();
    expect(view.rules.length).toBeGreaterThan(0);
    for (const rule of view.rules) {
      const ids = drillInvoiceIds(view, { kind: "rule", code: rule.code });
      expect(ids).toHaveLength(rule.invoiceIds.length);
      for (const id of ids) {
        const decision = await repos.getLatestDecision(p.t.db, p.organizationId, id);
        expect(decision?.findings.some((f) => f.code === rule.code)).toBe(true);
      }
    }
    const paid = view.budget.byCurrency.reduce((acc, s) => acc + s.committed.amount, 0);
    expect(paid + view.budget.earlier.amount).toBe(view.budget.committed.amount);
    for (const slice of view.budget.byCurrency) {
      const ids = drillInvoiceIds(view, { kind: "currency", currency: slice.currency });
      const amounts = await Promise.all(
        ids.map(
          async (id) => (await repos.getLatestDecision(p.t.db, p.organizationId, id))?.amount,
        ),
      );
      expect(amounts.every((a) => a?.currency === slice.currency)).toBe(true);
      expect(amounts.reduce((acc, a) => acc + (a?.amount ?? 0), 0)).toBe(slice.paid.amount);
    }
  });
});
