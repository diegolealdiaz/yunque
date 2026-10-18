/**
 * Errores tipados de los casos de uso. Cada uno trae código, severidad, si se puede
 * reintentar y la acción sugerida, para que la ruta responda con un mensaje accionable.
 *
 * Solo salen como excepción los casos en que no se registra factura: entrega rechazada,
 * empresa o política ausentes, almacenamiento caído. Todo fallo posterior al registro de
 * la factura se convierte en una decisión `escalar` con el error como hallazgo.
 */

import { DbError } from "@/src/db/errors";

/** La entidad pedida no existe o no es de esta empresa: las pantallas responden 404. */
export function isNotFound(error: unknown): boolean {
  return error instanceof DbError && error.code === "not_found";
}

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
  | "limit_reached"
  /** La política vigente ya no es la que se editó: otra persona guardó antes. */
  | "policy_changed"
  /** Quien firma no está en la lista de aprobadores de la política vigente. */
  | "not_authorized"
  /** La factura tiene una decisión más nueva que la que se estaba mirando. */
  | "decision_changed"
  /** El cambio afloja la política: entra en vigor solo con la firma de otra persona. */
  | "second_signature_required"
  /** Ya hay un cambio que afloja la política esperando la segunda firma. */
  | "proposal_pending"
  /** La propuesta ya no está pendiente, o la política cambió desde que se propuso. */
  | "proposal_closed"
  /** Los datos del beneficiario nuevo no son válidos o falta una confirmación. */
  | "invalid_vendor"
  /** Ya hay un beneficiario registrado con esa identificación, cuenta o nombre. */
  | "vendor_exists"
  /** La factura ya no admite registrar a su proveedor. */
  | "not_onboardable";

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
