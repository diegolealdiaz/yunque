/**
 * Errores tipados de los casos de uso. Cada uno trae código, severidad, si se puede
 * reintentar y la acción sugerida, para que la ruta responda con un mensaje accionable.
 *
 * Solo salen como excepción los casos en que no se registra factura: entrega rechazada,
 * empresa o política ausentes, almacenamiento caído. Todo fallo posterior al registro de
 * la factura se convierte en una decisión `escalar` con el error como hallazgo.
 */

export type UseCaseErrorCode =
  /** La entrega no es un documento aceptable: vacía, muy grande, tipo no soportado. */
  | "rejected_document"
  /** La empresa no existe. */
  | "organization_not_found"
  /** La empresa no tiene política vigente: no hay mandato con el que decidir. */
  | "policy_missing"
  /** No se pudo guardar el original. */
  | "storage_unavailable"
  /** Ni la decisión ni el escalado por error se pudieron registrar. */
  | "record_failed"
  /** Se alcanzó el tope de facturas del día, por visitante o global. */
  | "limit_reached";

export type Severity = "error" | "warning";

export class UseCaseError extends Error {
  readonly code: UseCaseErrorCode;
  readonly severity: Severity;
  readonly retryable: boolean;
  /** Qué puede hacer la persona o el cliente de la API. */
  readonly action: string;

  constructor(
    code: UseCaseErrorCode,
    message: string,
    options: { action: string; retryable?: boolean; severity?: Severity; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "UseCaseError";
    this.code = code;
    this.severity = options.severity ?? "error";
    this.retryable = options.retryable ?? false;
    this.action = options.action;
  }
}
