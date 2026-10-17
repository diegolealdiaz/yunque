import { randomBytes } from "node:crypto";

import {
  ExtractionSchema,
  jsonHash,
  type Extraction,
  type ExtractionRecord,
  type Sha256,
} from "@/src/domain";

import { detectCanary } from "./detector";
import { ModelError, type ModelClient, type ModelPart } from "./model";
import { costUsdMicros } from "./prices";
import {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  promptHash,
  systemPrompt,
  userParts,
  type PromptInput,
} from "./prompt";

/**
 * El Lector: una llamada al modelo con salida estructurada, validada por zod en nuestro
 * código, con exactamente un reintento. El reintento le dice al modelo qué falló; un error
 * terminal del proveedor (clave inválida, petición rechazada) no se reintenta, y ningún
 * intento pasa del plazo global de la factura.
 *
 * Caché exacta por hash de documento, versión de prompt, versión de esquema, modelo y hash
 * del prompt construido: el mismo PDF adjunto a dos correos distintos son dos entradas,
 * porque el cuerpo del correo también entra al prompt. Una lectura ilegible o en la que se
 * filtró el canario no se cachea. Cada llamada queda registrada con tokens, costo y
 * latencia; el registro y la caché son best-effort y nunca tumban la lectura.
 * El modelo no recibe vendors ni saldos.
 */

export type CacheKey = {
  readonly document_hash: Sha256;
  readonly prompt_version: string;
  readonly schema_version: number;
  readonly model: string;
  /** Hash del prompt sin canario: cubre el texto del canal y las imágenes enviadas. */
  readonly prompt_hash: string;
};

export interface ExtractionCache {
  get(key: CacheKey): Promise<ExtractionRecord | null>;
  put(key: CacheKey, record: ExtractionRecord): Promise<void>;
}

export type LlmCallLog = {
  readonly model: string;
  readonly prompt_version: string;
  readonly prompt_hash: string;
  readonly raw_output: string | null;
  readonly attempt: number;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cost_usd_micros: number;
  readonly latency_ms: number;
  readonly status: "ok" | "invalid_output" | "error";
  readonly error: string | null;
};

export type ReaderDeps = {
  readonly client: ModelClient;
  readonly cache: ExtractionCache;
  readonly logCall: (call: LlmCallLog) => Promise<void>;
  readonly now: () => number;
  /** Token secreto por proceso. Inyectable para pruebas. */
  readonly canary?: string;
};

export type ReadOptions = {
  readonly model: string;
  readonly maxOutputTokens: number;
  /** Plazo de cada intento. */
  readonly timeoutMs: number;
  readonly fallbackUsed: boolean;
  /**
   * Instante (en el reloj de `deps.now`) en que vence el plazo global de la factura. Ningún
   * intento empieza ni se extiende más allá; sin él, solo cuenta el plazo por intento.
   */
  readonly deadlineAt?: number;
};

export type ReadResult = {
  readonly record: ExtractionRecord;
  readonly from_cache: boolean;
  readonly canary_detected: boolean;
  readonly cost_usd_micros: number;
  readonly latency_ms: number;
};

export const MAX_ATTEMPTS = 2;

/** Si al plazo global le queda menos que esto, un intento no alcanza a responder: no se empieza. */
export const MIN_ATTEMPT_MS = 2_000;

/** Lo que resta del plazo global, o infinito si no hay plazo global. */
export function remainingMs(deadlineAt: number | undefined, now: number): number {
  return deadlineAt === undefined ? Number.POSITIVE_INFINITY : deadlineAt - now;
}

let processCanary: string | undefined;
function defaultCanary(): string {
  processCanary ??= `YQ-${randomBytes(12).toString("hex")}`;
  return processCanary;
}

/** Quita un posible bloque de código alrededor del JSON. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

/** Parsea y valida la salida del modelo. Devuelve el motivo si no sirve. */
export function parseModelOutput(raw: string): { extraction: Extraction } | { problem: string } {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw));
  } catch {
    return { problem: "la salida no es JSON" };
  }
  const parsed = ExtractionSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      problem: `salida fuera de esquema: ${first ? `${first.path.map(String).join(".")} ${first.message}` : "desconocido"}`,
    };
  }
  return { extraction: parsed.data };
}

/** Llave de caché de una lectura. */
export function cacheKeyFor(documentHash: Sha256, model: string, prompt: string): CacheKey {
  return {
    document_hash: documentHash,
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    model,
    prompt_hash: prompt,
  };
}

/** Parte extra del reintento: qué estuvo mal en la salida anterior, sin repetir el documento. */
function retryHint(problem: string): ModelPart {
  return {
    type: "text",
    text: `Tu respuesta anterior no se pudo usar (${problem.slice(0, 300)}). Devuelve solo el JSON con la forma pedida.`,
  };
}

export async function readDocument(
  deps: ReaderDeps,
  input: PromptInput & { readonly document_hash: Sha256 },
  options: ReadOptions,
): Promise<ReadResult> {
  const hash = promptHash(input);
  const key = cacheKeyFor(input.document_hash, options.model, hash);
  const cached = await deps.cache.get(key).catch(() => null);
  if (cached)
    return {
      record: cached,
      from_cache: true,
      canary_detected: false,
      cost_usd_micros: 0,
      latency_ms: 0,
    };

  const canary = deps.canary ?? defaultCanary();
  const system = systemPrompt(canary);
  const parts: ModelPart[] = userParts(input);

  let totalCost = 0;
  let totalLatency = 0;
  let canaryDetected = false;
  let lastProblem = "sin respuesta";
  let lastWasInvalidOutput = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = deps.now();
    const remaining = remainingMs(options.deadlineAt, started);
    if (remaining < MIN_ATTEMPT_MS) {
      lastProblem = "se agotó el plazo de lectura de la factura";
      break;
    }
    const timeoutMs = Math.min(options.timeoutMs, remaining);
    let raw: string | null = null;
    let status: LlmCallLog["status"] = "ok";
    let error: string | null = null;
    let extraction: Extraction | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let terminal = false;
    try {
      const response = await deps.client.complete({
        model: options.model,
        system,
        parts: attempt > 1 && lastWasInvalidOutput ? [...parts, retryHint(lastProblem)] : parts,
        maxOutputTokens: options.maxOutputTokens,
        timeoutMs,
      });
      raw = response.text;
      inputTokens = response.inputTokens;
      outputTokens = response.outputTokens;
      if (detectCanary(raw, canary)) canaryDetected = true;
      const parsed = parseModelOutput(raw);
      if ("extraction" in parsed) {
        extraction = parsed.extraction;
      } else {
        status = "invalid_output";
        error = parsed.problem;
        lastProblem = parsed.problem;
      }
    } catch (caught) {
      status = "error";
      error =
        caught instanceof ModelError ? `${caught.code}: ${caught.message}` : "error desconocido";
      lastProblem = error;
      terminal = caught instanceof ModelError && !caught.retryable;
    }
    lastWasInvalidOutput = status === "invalid_output";
    const latency = Math.max(0, deps.now() - started);
    const cost = costUsdMicros(options.model, inputTokens, outputTokens);
    totalCost += cost;
    totalLatency += latency;
    // El registro es best-effort: un fallo al escribirlo nunca afecta la lectura.
    await deps
      .logCall({
        model: options.model,
        prompt_version: PROMPT_VERSION,
        prompt_hash: hash,
        raw_output: raw,
        attempt,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd_micros: cost,
        latency_ms: latency,
        status,
        error,
      })
      .catch(() => undefined);
    if (extraction) {
      const record: ExtractionRecord = {
        extraction,
        extraction_hash: jsonHash(extraction),
        model: options.model,
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
        fallback_used: options.fallbackUsed,
      };
      // Con canario filtrado no se cachea: la señal debe repetirse en cada lectura.
      if (!canaryDetected) await deps.cache.put(key, record).catch(() => undefined);
      return {
        record,
        from_cache: false,
        canary_detected: canaryDetected,
        cost_usd_micros: totalCost,
        latency_ms: totalLatency,
      };
    }
    if (terminal) break;
  }

  // Dos intentos sin salida válida: "no la entendí" es un resultado tipado, no una excepción.
  const unreadable: Extraction = {
    kind: "unreadable",
    reason: `El modelo no devolvió una lectura válida (${lastProblem})`,
  };
  const record: ExtractionRecord = {
    extraction: unreadable,
    extraction_hash: jsonHash(unreadable),
    model: options.model,
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    fallback_used: options.fallbackUsed,
  };
  return {
    record,
    from_cache: false,
    canary_detected: canaryDetected,
    cost_usd_micros: totalCost,
    latency_ms: totalLatency,
  };
}
