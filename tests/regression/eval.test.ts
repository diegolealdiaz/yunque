import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
    fields: [
      { field: "total", expected: "100", actual: id === "mal-leida" ? "999" : "100" },
      { field: "payee_name", expected: "NUBE ANDINA SAS", actual: "NUBE ANDINA SAS" },
      { field: "currency", expected: "COP", actual: "COP" },
      { field: "invoice_number", expected: "F2291", actual: "F2291" },
    ],
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

  it("frenar facturas normales, explicar a medias o no medir un campo crítico también falla", () => {
    const stopped = computeMetrics([row("frenada", "pagar", "frenar")]);
    expect(evaluateGate(stopped, 0).failures).toContain("normales frenadas: 1/1");
    const unexplained = computeMetrics([{ ...row("ok", "pagar", "pagar"), explained: false }]);
    expect(evaluateGate(unexplained, 0).failures).toContain("explicabilidad: 0/1");
    const unmeasured = computeMetrics([{ ...row("ok", "pagar", "pagar"), fields: [] }]);
    expect(evaluateGate(unmeasured, 0).failures).toContain("exactitud de total: no se midió");
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

  const copies: string[] = [];
  afterAll(async () => {
    for (const d of [dir, ...copies]) await rm(d, { recursive: true, force: true });
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

  it("P-93 una fixture rota pone la puerta en rojo por sus decisiones, no solo por faltantes", async () => {
    const files = (await readdir(path.join(dir, PROMPT_VERSION))).sort();
    const broken = new FixtureStore(await copyFixtures(files));
    const [first] = files;
    if (!first) throw new Error("faltan fixtures grabadas");
    await writeFile(
      path.join(broken.directory(), first),
      JSON.stringify({
        model: "anthropic/claude-haiku-5.5",
        prompt_version: PROMPT_VERSION,
        text: "esto no es JSON",
        input_tokens: null,
        output_tokens: null,
        latency_ms: 0,
      }),
    );
    const result = await runEvaluation({ source: "fixtures", fixtures: broken });
    // El Lector reintenta con la pista de error y ese reintento tampoco está grabado; pero
    // aun sin contar faltantes, la lectura rota ya degrada las decisiones y la puerta cae.
    expect(evaluateGate(result.metrics, 0).passed).toBe(false);
  }, 120_000);

  it("P-93 una fixture ausente pone la puerta en rojo", async () => {
    const files = (await readdir(path.join(dir, PROMPT_VERSION))).sort();
    const partial = new FixtureStore(await copyFixtures(files));
    const [first] = files;
    if (!first) throw new Error("faltan fixtures grabadas");
    await rm(path.join(partial.directory(), first));
    const result = await runEvaluation({ source: "fixtures", fixtures: partial });
    expect(result.missing_fixtures.length).toBeGreaterThan(0);
    expect(evaluateGate(result.metrics, result.missing_fixtures.length).passed).toBe(false);
  }, 120_000);

  /** Copia las fixtures grabadas a un directorio nuevo, para romperlas sin tocar las originales. */
  async function copyFixtures(files: readonly string[]): Promise<string> {
    const target = await mkdtemp(path.join(os.tmpdir(), "yunque-eval-copia-"));
    copies.push(target);
    await mkdir(path.join(target, PROMPT_VERSION), { recursive: true });
    for (const file of files) {
      await copyFile(path.join(dir, PROMPT_VERSION, file), path.join(target, PROMPT_VERSION, file));
    }
    return target;
  }
});
