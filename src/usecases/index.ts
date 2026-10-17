/**
 * Casos de uso: orquestan dominio, motor, extracción y base. Es la única capa que conoce
 * a todas las demás; las rutas de la app y los canales solo hablan con esta.
 */
export * from "./audit-log";
export * from "./business-day";
export * from "./correct-invoice";
export * from "./demo-access";
export type { DecideDeps } from "./decide";
export * from "./errors";
export * from "./explanation-rating";
export * from "./health";
export * from "./inbound-email";
export * from "./inbox";
export * from "./invoice-detail";
export * from "./invoice-list";
export * from "./metrics";
export * from "./notifications";
export * from "./payment-order";
export * from "./invoice-reader";
export * from "./policy";
export * from "./policy-view";
export * from "./process-invoice";
export * from "./resolve-escalation";
export * from "./telegram";
export { APPROVAL_TTL_DAYS } from "./record-decision";
// La regla que decidió una decisión: la pantalla la nombra al contar cómo quedó.
export { decidingFinding } from "@/src/engine";
