/**
 * Casos de uso: orquestan dominio, motor, extracción y base. Es la única capa que conoce
 * a todas las demás; las rutas de la app y los canales solo hablan con esta.
 */
export * from "./business-day";
export * from "./errors";
export * from "./inbox";
export * from "./invoice-detail";
export * from "./invoice-reader";
export * from "./process-invoice";
export * from "./resolve-escalation";
export { APPROVAL_TTL_DAYS } from "./record-decision";
