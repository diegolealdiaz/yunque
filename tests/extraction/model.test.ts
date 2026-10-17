import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";

import { ModelError, createOpenRouterClient } from "@/src/extraction/model";

/**
 * El cliente real clasifica los errores del proveedor (docs/practicas.md 8): solo 429, 5xx y
 * la red caída se reintentan; una clave inválida o una petición rechazada son terminales.
 * El SDK se reemplaza para no salir a la red.
 */

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (original) => ({ ...(await original<typeof import("ai")>()), generateText }));

const request = {
  model: "modelo/prueba",
  system: "s",
  parts: [{ type: "text", text: "t" }],
  maxOutputTokens: 100,
  timeoutMs: 1000,
} as const;

function providerError(statusCode: number | undefined): APICallError {
  return new APICallError({
    message: "fallo",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    // El SDK marca 409 como reintentable; la clasificación es nuestra y no lo sigue.
    isRetryable: true,
  });
}

async function failureOf(error: unknown): Promise<ModelError> {
  generateText.mockRejectedValueOnce(error);
  const caught: unknown = await createOpenRouterClient("clave")
    .complete(request)
    .catch((e: unknown) => e);
  if (!(caught instanceof ModelError)) throw new Error("se esperaba un ModelError");
  return caught;
}

describe("clasificación de errores del proveedor", () => {
  it.each([
    [401, false],
    [408, false],
    [409, false],
    [422, false],
    [429, true],
    [500, true],
    [503, true],
    [undefined, true],
  ])("estado %s: reintentable %s", async (status, retryable) => {
    const error = await failureOf(providerError(status));
    expect(error.code).toBe("provider");
    expect(error.retryable).toBe(retryable);
  });

  it("un error que no viene del proveedor es terminal", async () => {
    const error = await failureOf(new TypeError("no es una función"));
    expect(error.retryable).toBe(false);
  });

  it("una respuesta vacía se reintenta", async () => {
    generateText.mockResolvedValueOnce({ text: "  ", usage: {} });
    const caught: unknown = await createOpenRouterClient("clave")
      .complete(request)
      .catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ModelError);
    expect(caught instanceof ModelError && caught.code === "empty" && caught.retryable).toBe(true);
  });
});
