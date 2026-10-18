import { z } from "zod";

import { ActorSchema } from "./decision";
import { UlidSchema } from "./ids";

/**
 * Evento de bitácora: append-only. Cada transición del sistema escribe uno. Es la única
 * fuente para notificaciones y métricas. Nunca se edita ni se borra.
 */

export const EventTypeSchema = z.enum([
  "invoice.received",
  "invoice.processing",
  "invoice.normalized",
  "invoice.extracted",
  "invoice.decided",
  "invoice.escalated",
  "invoice.approved",
  "invoice.rejected",
  "invoice.corrected",
  "invoice.failed",
  "policy.saved",
  "policy.proposed",
  "policy.proposal_closed",
  "policy.replayed",
  "controls.changed",
  "vendor.created",
  "vendor.verified",
  "vendor.account_changed",
  "notification.sent",
  "notification.failed",
  "llm.called",
  "llm.failed",
  "email.rejected",
  "explanation.rated",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const AuditEventSchema = z.strictObject({
  id: UlidSchema,
  organization_id: UlidSchema,
  type: EventTypeSchema,
  actor: ActorSchema,
  invoice_id: UlidSchema.nullable(),
  decision_id: UlidSchema.nullable(),
  /** Datos del evento. Solo valores serializables; nunca el texto completo del documento. */
  data: z.record(z.string(), z.unknown()),
  /** Id de traza para correlacionar con la petición HTTP y las llamadas al modelo. */
  trace_id: z.string().min(1).max(100),
  occurred_at: z.iso.datetime(),
});
export type AuditEvent = Readonly<z.infer<typeof AuditEventSchema>>;
