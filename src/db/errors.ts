/**
 * Errores tipados de la capa de datos. Cada uno dice qué pasó y si vale reintentar.
 */

export type DbErrorCode =
  | "not_found"
  | "conflict"
  | "stale_state"
  | "append_only"
  | "budget_exceeded"
  | "insufficient_balance";

export class DbError extends Error {
  readonly code: DbErrorCode;
  readonly retryable: boolean;

  constructor(code: DbErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "DbError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** Mensajes del error y de toda su cadena de causas: drizzle envuelve el error del driver. */
function messagesOf(error: unknown): string[] {
  const out: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    out.push(current.message);
    current = current.cause;
  }
  return out;
}

/** Verdadero si el driver rechazó por una restricción única. */
export function isUniqueViolation(error: unknown): boolean {
  return messagesOf(error).some((m) => /UNIQUE constraint failed/i.test(m));
}

/** Verdadero si un trigger de tabla append-only abortó la escritura. */
export function isAppendOnlyViolation(error: unknown): boolean {
  return messagesOf(error).some((m) => /append_only/.test(m));
}
