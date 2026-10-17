import { z } from "zod";

import { UlidSchema } from "./ids";

/**
 * Registro de una llamada al modelo: qué se pidió, qué devolvió y cuánto costó. Es la base
 * del costo por factura y el dataset de regresión al cambiar de modelo o de prompt.
 * Escribirlo es best-effort: si falla, la lectura sigue.
 */

export const LlmCallStatusSchema = z.enum(["ok", "invalid_output", "error"]);
export type LlmCallStatus = z.infer<typeof LlmCallStatusSchema>;

export const LlmCallSchema = z.strictObject({
  id: UlidSchema,
  organization_id: UlidSchema,
  invoice_id: UlidSchema.nullable(),
  model: z.string().min(1).max(100),
  prompt_version: z.string().min(1).max(50),
  prompt_hash: z.string().min(1).max(100),
  /** Salida cruda del modelo, recortada. Es contenido no confiable: nunca se renderiza. */
  raw_output: z.string().max(20_000).nullable(),
  attempt: z.number().int().min(1),
  input_tokens: z.number().int().min(0).nullable(),
  output_tokens: z.number().int().min(0).nullable(),
  cost_usd_micros: z.number().int().min(0),
  latency_ms: z.number().int().min(0),
  status: LlmCallStatusSchema,
  trace_id: z.string().min(1).max(100),
  created_at: z.iso.datetime(),
});
export type LlmCall = Readonly<z.infer<typeof LlmCallSchema>>;
