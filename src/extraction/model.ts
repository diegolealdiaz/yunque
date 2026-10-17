import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, generateText } from "ai";

/**
 * Cliente del modelo. Única puerta al SDK: el resto del sistema habla con esta interfaz y
 * las pruebas usan un cliente simulado. Temperatura cero, salida acotada, sin reintentos
 * del SDK (los reintentos son nuestros y están contados).
 */

export type ModelPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly bytes: Uint8Array;
      readonly mediaType: "image/png" | "image/jpeg";
    };

export type ModelRequest = {
  readonly model: string;
  readonly system: string;
  readonly parts: readonly ModelPart[];
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
};

export type ModelResponse = {
  readonly text: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
};

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * Error del modelo. `retryable` dice si vale la pena el reintento: un plazo vencido, una
 * respuesta vacía, 429 o 5xx sí; una clave inválida o una petición rechazada (4xx) no.
 */
export class ModelError extends Error {
  readonly code: "timeout" | "provider" | "empty";
  readonly retryable: boolean;
  constructor(code: ModelError["code"], message: string, retryable: boolean) {
    super(message);
    this.name = "ModelError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

/** Cliente real sobre OpenRouter. */
export function createOpenRouterClient(apiKey: string): ModelClient {
  const provider = createOpenRouter({ apiKey });
  return {
    async complete(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const result = await generateText({
          model: provider.chat(request.model),
          system: request.system,
          messages: [
            {
              role: "user",
              content: request.parts.map((p) =>
                p.type === "text"
                  ? { type: "text" as const, text: p.text }
                  : { type: "image" as const, image: p.bytes, mediaType: p.mediaType },
              ),
            },
          ],
          temperature: 0,
          maxOutputTokens: request.maxOutputTokens,
          maxRetries: 0,
          abortSignal: controller.signal,
        });
        if (result.text.trim().length === 0)
          throw new ModelError("empty", "El modelo no devolvió texto", true);
        return {
          text: result.text,
          inputTokens: result.usage.inputTokens ?? null,
          outputTokens: result.usage.outputTokens ?? null,
        };
      } catch (error) {
        if (error instanceof ModelError) throw error;
        if (controller.signal.aborted) {
          throw new ModelError(
            "timeout",
            `El modelo no respondió en ${String(request.timeoutMs)} ms`,
            true,
          );
        }
        if (APICallError.isInstance(error)) {
          const status = error.statusCode;
          throw new ModelError(
            "provider",
            `${status === undefined ? "sin estado" : String(status)}: ${error.message}`,
            error.isRetryable || isRetryableStatus(status),
          );
        }
        const message = error instanceof Error ? error.message : "error del proveedor";
        throw new ModelError("provider", message, true);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
