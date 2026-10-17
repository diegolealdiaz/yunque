import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  channelOfFormat,
  idealExtraction,
  loadDatasetSources,
  loadGroundTruth,
} from "@/src/dataset";
import { closeDatabase, createDatabase, runMigrations } from "@/src/db/client";
import { appendPolicyVersion, getLatestExtraction } from "@/src/db/repositories";
import { loadSeedData, seedDatasetOrganization } from "@/src/db/seed";
import { createUlidGenerator, type Policy } from "@/src/domain";
import { MemoryFileStorage, type ModelClient } from "@/src/extraction";
import { createModelReader, processInvoice } from "@/src/usecases";

import { FixtureStore, fixtureClient, recordingClient } from "./fixtures";
import { computeMetrics, type EvalRow, type Metrics } from "./metrics";
import { evalRowFor } from "./rows";

/**
 * Corre el set de regresión de punta a punta: una base temporal sembrada como el dataset,
 * cada caso de `verdad.json` en orden por `processInvoice` (ingesta real con PDFium, Lector,
 * Verificador, Detector, motor y registro), y la comparación contra la verdad esperada.
 *
 * Fuentes del Lector:
 * - `fixtures`: respuestas grabadas del modelo. Sin red. Es lo que corre CI.
 * - `live`: el modelo real; cada respuesta se graba como fixture.
 * - `ideal`: un Lector perfecto derivado del manifiesto. No mide al modelo; mide todo lo
 *   que viene después de él, y sirve mientras no haya fixtures grabadas.
 */

export type EvalSource = "fixtures" | "live" | "ideal";

export type RunEvaluationOptions = {
  readonly source: EvalSource;
  /** Cliente real del modelo; obligatorio con `live`. */
  readonly liveClient?: ModelClient;
  /** Dónde se leen (fixtures) o se graban (live) las respuestas. */
  readonly fixtures?: FixtureStore;
  /** Graba también lo que responda la fuente elegida (las pruebas graban el Lector ideal). */
  readonly recordTo?: FixtureStore;
  readonly primaryModel?: string;
  readonly fallbackModel?: string | null;
  /** Cambia la política antes de procesar: así la prueba de la puerta relaja una regla. */
  readonly adjustPolicy?: (policy: Policy) => Policy;
};

export type EvaluationResult = {
  readonly source: EvalSource;
  readonly models: { readonly primary: string; readonly fallback: string | null };
  readonly rows: readonly EvalRow[];
  readonly metrics: Metrics;
  /** Peticiones al modelo sin fixture grabada. Con `fixtures`, cualquiera hace fallar la puerta. */
  readonly missing_fixtures: readonly string[];
};

export const DEFAULT_PRIMARY_MODEL = "anthropic/claude-haiku-5.5";
export const DEFAULT_FALLBACK_MODEL = "anthropic/claude-sonnet-5.5";
/**
 * Tope del sistema con el que se calibró el dataset. Es fijo a propósito: con el tope del
 * entorno local, los límites de la política cambiarían y los veredictos esperados también.
 */
const DATASET_HARD_CAP_USD_CENTS = 10_000_000;
const DATASET_DIR = path.join(process.cwd(), "data", "dataset", "generado");
const LIMITS = { maxUploadBytes: 5 * 1024 * 1024, maxPages: 5 } as const;

export async function runEvaluation(options: RunEvaluationOptions): Promise<EvaluationResult> {
  const primary = options.primaryModel ?? DEFAULT_PRIMARY_MODEL;
  const fallback =
    options.fallbackModel === undefined ? DEFAULT_FALLBACK_MODEL : options.fallbackModel;
  const store = options.fixtures ?? new FixtureStore();
  const [src, truth, seedData] = await Promise.all([
    loadDatasetSources(),
    loadGroundTruth(),
    loadSeedData(),
  ]);

  // El Lector ideal responde lo que corresponde al caso en curso: el lote es secuencial.
  let idealAnswer = "";
  const ideal: ModelClient = {
    complete: () => Promise.resolve({ text: idealAnswer, inputTokens: null, outputTokens: null }),
  };
  const replay = fixtureClient(store);
  let client: ModelClient;
  if (options.source === "live") {
    if (!options.liveClient)
      throw new Error("La evaluación en vivo necesita el cliente del modelo");
    client = recordingClient(options.liveClient, store);
  } else {
    client = options.source === "ideal" ? ideal : replay;
  }
  if (options.recordTo) client = recordingClient(client, options.recordTo);

  const dir = await mkdtemp(path.join(os.tmpdir(), "yunque-eval-"));
  const db = await createDatabase({ url: `file:${path.join(dir, "eval.db")}` });
  try {
    await runMigrations(db);
    const newId = createUlidGenerator();
    const now = () => new Date();
    const seeded = await seedDatasetOrganization(db, {
      data: seedData,
      newId,
      now,
      systemHardCapUsdCents: DATASET_HARD_CAP_USD_CENTS,
      visitorId: null,
      history: src.history,
      committedUsdCents: src.manifest.october_committed_usd_cents,
      today: src.manifest.today,
    });
    const organizationId = seeded.organization.id;
    if (options.adjustPolicy) {
      await appendPolicyVersion(
        db,
        organizationId,
        {
          content: options.adjustPolicy(seeded.policyVersion.content),
          signedBy: "evaluación",
          signedAt: now().toISOString(),
          note: "Política ajustada para la evaluación",
        },
        newId,
      );
    }

    const storage = new MemoryFileStorage();
    const deps = {
      db,
      storage,
      reader: createModelReader({
        db,
        storage,
        client,
        primaryModel: primary,
        fallbackModel: fallback,
        maxOutputTokens: 1500,
        cacheScope: (id: string) => id,
        newId,
        now,
      }),
      limits: LIMITS,
      newId,
      now,
      // El dataset está fechado en hora de Bogotá: la evaluación no depende del despliegue.
      timeZone: "America/Bogota",
      businessDate: src.manifest.today,
    };

    const rows: EvalRow[] = [];
    for (const generated of truth.cases) {
      const c = src.manifest.cases.find((m) => m.id === generated.id);
      const template = c && src.templates.get(c.template);
      if (!c || !template) throw new Error(`El caso ${generated.id} no está en el manifiesto`);
      idealAnswer = JSON.stringify(idealExtraction(c, template));
      const bytes = new Uint8Array(await readFile(path.join(DATASET_DIR, generated.file)));
      const started = performance.now();
      const result = await processInvoice(deps, {
        organizationId,
        channel: channelOfFormat(c.format),
        receiptKey: `eval:${c.id}`,
        bytes,
        originalName: generated.file,
      });
      const latency = Math.round(performance.now() - started);
      if (result.kind !== "decided") throw new Error(`El caso ${c.id} ya estaba recibido`);
      const { decision } = result;
      const stored = await getLatestExtraction(db, organizationId, decision.invoice_id);
      rows.push(evalRowFor(c, decision, stored?.record.extraction ?? null, latency));
    }

    return {
      source: options.source,
      models: { primary, fallback },
      rows,
      metrics: computeMetrics(rows),
      missing_fixtures: [...new Set(replay.missing)],
    };
  } finally {
    closeDatabase(db);
    await rm(dir, { recursive: true, force: true });
  }
}
