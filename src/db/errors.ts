/**
 * Errores tipados de la capa de datos. Cada uno dice qué pasó y si vale reintentar.
 */

export type DbErrorCode =
  | "not_found"
  | "conflict"
  | "stale_state"
  | "append_only"
  | "budget_exceeded"
  | "insufficient_balance"
  | "busy"
  | "corrupt";

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

/** Verdadero si una clave foránea rechazó la escritura. */
export function isForeignKeyViolation(error: unknown): boolean {
  return messagesOf(error).some((m) => /FOREIGN KEY constraint failed/i.test(m));
}

/** Verdadero si un trigger de invariante numérica abortó la escritura. */
export function isCheckViolation(error: unknown): boolean {
  return messagesOf(error).some((m) => /^check:|check: /.test(m));
}

/** Verdadero si SQLite estaba ocupada o bloqueada por otra transacción: vale reintentar. */
export function isBusy(error: unknown): boolean {
  return messagesOf(error).some((m) =>
    /SQLITE_BUSY|database is locked|TRANSACTION_ACTIVE/i.test(m),
  );
}

/** Convierte un error del driver en `DbError` cuando se reconoce; si no, lo devuelve tal cual. */
export function toDbError(error: unknown): unknown {
  if (error instanceof DbError) return error;
  if (isBusy(error)) return new DbError("busy", "La base está ocupada; reintentar", true);
  if (isAppendOnlyViolation(error)) {
    return new DbError("append_only", "Esa tabla no admite modificar ni borrar filas");
  }
  return error;
}
