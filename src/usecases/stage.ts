import { DbError } from "@/src/db/errors";
import { IngestError, ModelError } from "@/src/extraction";

import { UseCaseError } from "./errors";

/**
 * Etapas del procesamiento de una factura. Cada error dentro de una etapa sale envuelto con
 * el nombre de la etapa, que es lo que la persona lee en el hallazgo `processing_error`.
 */

export const STAGE_LABELS = {
  normalize: "normalización del documento",
  read: "lectura y verificación",
  resolve: "resolución del beneficiario",
  evaluate: "evaluación de reglas",
  record: "registro de la decisión",
} as const;
export type Stage = keyof typeof STAGE_LABELS;

export class StageFailure extends Error {
  readonly stage: Stage;
  constructor(stage: Stage, cause: unknown) {
    super(`Falló la etapa ${stage}`, { cause });
    this.name = "StageFailure";
    this.stage = stage;
  }
}

export async function inStage<T>(stage: Stage, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw error instanceof StageFailure ? error : new StageFailure(stage, error);
  }
}

/** Código corto y mensaje seguro de un error. Un error desconocido no expone su texto. */
export function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof IngestError) return { code: error.code, message: error.message };
  if (error instanceof DbError) return { code: error.code, message: "error de la base de datos" };
  if (error instanceof ModelError) return { code: error.code, message: "error del modelo" };
  if (error instanceof UseCaseError) return { code: error.code, message: error.message };
  return { code: "unexpected", message: "error inesperado" };
}
