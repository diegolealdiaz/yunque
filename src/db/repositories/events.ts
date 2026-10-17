import { and, desc, eq } from "drizzle-orm";

import { AuditEventSchema, type AuditEvent, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { parseRow } from "../rows";
import { auditEvents } from "../schema";

/** Bitácora append-only. */

/** Agrega un evento a la bitácora. Nunca se edita ni se borra. */
export async function appendEvent(exec: Executor, event: AuditEvent): Promise<void> {
  const e = AuditEventSchema.parse(event);
  await exec.insert(auditEvents).values({
    id: e.id,
    organizationId: e.organization_id,
    type: e.type,
    actor: e.actor,
    invoiceId: e.invoice_id,
    decisionId: e.decision_id,
    data: e.data,
    traceId: e.trace_id,
    occurredAt: e.occurred_at,
  });
}

/** Eventos de la organización, más recientes primero, con filtro opcional por factura. */
export async function listEvents(
  exec: Executor,
  organizationId: Ulid,
  filter: { invoiceId?: Ulid; limit?: number } = {},
): Promise<AuditEvent[]> {
  const rows = await exec.query.auditEvents.findMany({
    where: and(
      eq(auditEvents.organizationId, organizationId),
      filter.invoiceId === undefined ? undefined : eq(auditEvents.invoiceId, filter.invoiceId),
    ),
    orderBy: [desc(auditEvents.occurredAt), desc(auditEvents.id)],
    limit: filter.limit ?? 200,
  });
  return rows.map((row) =>
    parseRow(
      AuditEventSchema,
      {
        id: row.id,
        organization_id: row.organizationId,
        type: row.type,
        actor: row.actor,
        invoice_id: row.invoiceId,
        decision_id: row.decisionId,
        data: row.data,
        trace_id: row.traceId,
        occurred_at: row.occurredAt,
      },
      "audit_events",
    ),
  );
}
