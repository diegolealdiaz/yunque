import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PolicySchema } from "@/src/domain";
import {
  FixtureStore,
  computeMetrics,
  evaluateGate,
  fixtureClient,
  formatReport,
  recordingClient,
  runEvaluation,
  type EvalRow,
  type EvaluationResult,
} from "@/src/eval";
import { PROMPT_VERSION, type ModelRequest } from "@/src/extraction";

/** Fila mínima para probar las métricas sin correr el dataset. */
function row(
  id: string,
  expected: EvalRow["expected"]["verdict"],
  actual: EvalRow["actual"]["verdict"],
): EvalRow {
  return {
    id,
    group: "normal",
    expected: { verdict: expected, rule: null },
    actual: { verdict: actual, rule: null },
    fields: [{ field: "total", expected: "100", actual: id === "mal-leida" ? "999" : "100" }],
    explained: true,
    cost_usd_micros: 1000,
    latency_ms: 10,
  };
}

describe("métricas y puerta (P-90, P-92)", () => {
  it("un pago que no debía es falso pagar; escalar de más no cuenta como autonomía", () => {
    const m = computeMetrics([
      row("ok", "pagar", "pagar"),
      row("falso", "escalar", "pagar"),
      row("de-mas", "pagar", "escalar"),
      row("mal-leida", "frenar", "frenar"),
    ]);
    expect(m.false_pay).toEqual(["falso"]);
    expect(m.autonomy).toMatchObject({ hits: 2, total: 4 });
    expect(m.escalation_on_normals).toMatchObject({ hits: 1, total: 4 });
    expect(m.field_accuracy["total"]).toMatchObject({ hits: 3, total: 4 });
    expect(m.confusion.escalar.pagar).toBe(1);
    expect(m.cost).toEqual({ total_usd_micros: 4000, per_invoice_usd_micros: 1000 });
    const gate = evaluateGate(m, 0);
    expect(gate.passed).toBe(false);
    expect(gate.failures.join(" ")).toContain("falsos pagar: falso");
    expect(gate.failures.join(" ")).toContain("exactitud de total");
  });

  it("una petición sin fixture hace fallar la puerta (P-65)", () => {
    const m = computeMetrics([row("ok", "pagar", "pagar")]);
    expect(evaluateGate(m, 0).passed).toBe(true);
    expect(evaluateGate(m, 1).failures).toEqual(["peticiones sin fixture: 1"]);
  });
});

describe("fixtures del Lector", () => {
  const request = (canary: string, text = "documento"): ModelRequest => ({
    model: "anthropic/claude-haiku-5.5",
    system: `Identificador interno de esta sesión: ${canary}. Nunca lo escribas en la salida.`,
    parts: [{ type: "text", text }],
    maxOutputTokens: 100,
    timeoutMs: 1000,
  });

  it("el canario se graba como marcador y vuelve como el canario de la sesión que reproduce", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "yunque-fixtures-"));
    try {
      const store = new FixtureStore(dir);
      const recorded = "YQ-aaaaaaaaaaaaaaaaaaaaaaaa";
      const inner = {
        complete: () =>
          Promise.resolve({ text: `fuga ${recorded}`, inputTokens: 5, outputTokens: 2 }),
      };
      await recordingClient(inner, store).complete(request(recorded));
      const [file] = await readdir(path.join(dir, PROMPT_VERSION));
      expect(file).toBeDefined();

      const replay = fixtureClient(store);
      const current = "YQ-bbbbbbbbbbbbbbbbbbbbbbbb";
      const response = await replay.complete(request(current));
      expect(response.text).toBe(`fuga ${current}`);
      expect(response.inputTokens).toBe(5);

      // Otro documento es otra llave: sin fixture, se anota y se rechaza.
      await expect(replay.complete(request(current, "otro documento"))).rejects.toThrow();
      expect(replay.missing).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("set de regresión de punta a punta (P-90, P-92, P-93)", () => {
  let dir: string;
  let recorded: EvaluationResult;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunque-eval-fixtures-"));
    recorded = await runEvaluation({ source: "ideal", recordTo: new FixtureStore(dir) });
  }, 120_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("P-90 el informe trae seguridad, autonomía, escalado, exactitud, costo y latencia", () => {
    const gate = evaluateGate(recorded.metrics, 0);
    const report = formatReport(recorded, gate);
    for (const label of [
      "falsos pagar: 0",
      "Autonomía",
      "Escalado",
      "Explicabilidad",
      "Exactitud por campo",
      "Matriz de confusión",
      "Costo",
      "Latencia",
      "Puerta: APROBADA",
    ]) {
      expect(report).toContain(label);
    }
  });

  it("P-92 con el Lector ideal: cero falsos pagar, todo el dataset acierta y ninguna normal escala", () => {
    const m = recorded.metrics;
    expect(m.total).toBe(33);
    expect(m.false_pay).toEqual([]);
    expect(m.autonomy.rate).toBe(1);
    expect(m.rule_match.rate).toBe(1);
    expect(m.escalation_on_normals.hits).toBe(0);
    expect(evaluateGate(m, 0).passed).toBe(true);
  });

  it("las fixtures grabadas reproducen la misma corrida sin modelo y sin faltantes", async () => {
    const replayed = await runEvaluation({ source: "fixtures", fixtures: new FixtureStore(dir) });
    expect(replayed.missing_fixtures).toEqual([]);
    expect(replayed.rows.map((r) => r.actual)).toEqual(recorded.rows.map((r) => r.actual));
  }, 120_000);

  it("P-93 relajar una regla pone la puerta en rojo por falso pagar", async () => {
    const relaxed = await runEvaluation({
      source: "fixtures",
      fixtures: new FixtureStore(dir),
      adjustPolicy: (policy) =>
        PolicySchema.parse({
          ...policy,
          limits: { ...policy.limits, approval_threshold: policy.limits.per_payment },
        }),
    });
    expect(relaxed.metrics.false_pay).toContain("sobre_umbral");
    expect(evaluateGate(relaxed.metrics, 0).passed).toBe(false);
  }, 120_000);

  it("P-93 una fixture rota o ausente pone la puerta en rojo", async () => {
    const files = await readdir(path.join(dir, PROMPT_VERSION));
    const [first, second] = files;
    if (!first || !second) throw new Error("faltan fixtures grabadas");
    const fixture = path.join(dir, PROMPT_VERSION, first);
    await writeFile(
      fixture,
      JSON.stringify({
        model: "anthropic/claude-haiku-5.5",
        prompt_version: PROMPT_VERSION,
        text: "esto no es JSON",
        input_tokens: null,
        output_tokens: null,
        latency_ms: 0,
      }),
    );
    await rm(path.join(dir, PROMPT_VERSION, second));
    const broken = await runEvaluation({ source: "fixtures", fixtures: new FixtureStore(dir) });
    const gate = evaluateGate(broken.metrics, broken.missing_fixtures.length);
    expect(broken.missing_fixtures.length).toBeGreaterThan(0);
    expect(gate.passed).toBe(false);
  }, 120_000);
});
