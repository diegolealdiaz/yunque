import "./env";

import { z } from "zod";

import { getConfig } from "@/src/config";
import {
  FixtureStore,
  evaluateGate,
  formatReport,
  runEvaluation,
  type EvalSource,
} from "@/src/eval";
import { PROMPT_VERSION, createOpenRouterClient } from "@/src/extraction";

/**
 * `npm run eval`: corre el set de regresión y sale en rojo si la puerta no pasa.
 *
 *   npm run eval                     respuestas grabadas (tests/fixtures/lector), sin red
 *   EVAL_SOURCE=ideal npm run eval   Lector ideal: mide todo lo que viene después del modelo
 *   EVAL_LIVE=1 npm run eval         modelo real con la clave; graba las respuestas como fixtures
 *
 * Las dos variables son del comando, no de la app: por eso se leen aquí y no en la configuración.
 */
const FlagsSchema = z.object({
  EVAL_LIVE: z.enum(["0", "1"]).optional(),
  EVAL_SOURCE: z.enum(["fixtures", "ideal"]).optional(),
});

async function main(): Promise<void> {
  const flags = FlagsSchema.parse({
    EVAL_LIVE: process.env["EVAL_LIVE"] || undefined,
    EVAL_SOURCE: process.env["EVAL_SOURCE"] || undefined,
  });
  const config = getConfig();
  const source: EvalSource = flags.EVAL_LIVE === "1" ? "live" : (flags.EVAL_SOURCE ?? "fixtures");
  const store = new FixtureStore();

  if (source === "live" && config.model === null) {
    console.error("EVAL_LIVE=1 necesita OPENROUTER_API_KEY en .env.local");
    process.exitCode = 1;
    return;
  }
  if (source === "fixtures" && (await store.count()) === 0) {
    console.error(
      `No hay respuestas grabadas para ${PROMPT_VERSION}. Graba con EVAL_LIVE=1 npm run eval (necesita la clave) o mide sin modelo con EVAL_SOURCE=ideal npm run eval.`,
    );
    process.exitCode = 1;
    return;
  }

  const result = await runEvaluation({
    source,
    fixtures: store,
    ...(config.model
      ? {
          liveClient: createOpenRouterClient(config.model.apiKey),
          primaryModel: config.model.primary,
          fallbackModel: config.model.fallback,
        }
      : {}),
  });
  const gate = evaluateGate(
    result.metrics,
    source === "fixtures" ? result.missing_fixtures.length : 0,
  );
  console.warn(formatReport(result, gate));
  if (!gate.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
