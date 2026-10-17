import type { z } from "zod";

import { DbError } from "./errors";

/**
 * Valida una fila leída con el esquema del dominio. Una fila que no cumple el esquema es
 * un dato corrupto, no un error de programación: sale como `DbError("corrupt")` con el
 * nombre de la entidad y el primer problema, nunca como un `ZodError` crudo.
 */
export function parseRow<T extends z.ZodType>(
  schema: T,
  value: unknown,
  entity: string,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  const where = first ? `${first.path.map(String).join(".")}: ${first.message}` : "esquema";
  throw new DbError("corrupt", `Fila de ${entity} inválida en base (${where})`);
}
