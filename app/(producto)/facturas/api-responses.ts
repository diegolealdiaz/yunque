import { z } from "zod";

/**
 * Respuestas de `/api/procesar` y `/api/lote`, validadas también en el navegador: la pantalla
 * no supone la forma de lo que llega, la comprueba. Sin importar el dominio, que usa
 * `node:crypto` y no viaja al navegador.
 */

export const ProcessResponseSchema = z.object({
  kind: z.enum(["decided", "already_received"]),
  invoiceId: z.string(),
  reference: z.string(),
  verdict: z.enum(["pagar", "frenar", "escalar"]).nullable(),
});
export type ProcessResponse = z.infer<typeof ProcessResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), action: z.string() }),
});

/** Mensaje para la persona a partir de una respuesta de error, con causa y salida. */
export function errorMessage(body: unknown, fallback: string): string {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success ? `${parsed.data.error.message}. ${parsed.data.error.action}.` : fallback;
}
