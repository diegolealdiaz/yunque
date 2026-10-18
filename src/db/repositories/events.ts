import { and, desc, eq, notInArray, sql } from "drizzle-orm";

import { AuditEventSchema, type AuditEvent, type EventType, type Ulid } from "@/src/domain";

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

export type EventFilter = {
  readonly invoiceId?: Ulid;
  readonly type?: EventType;
  /** Tipos que no se traen: los pasos internos, cuando solo interesan las decisiones. */
  readonly excludeTypes?: readonly EventType[];
  /** Quién: el agente, o una persona por su nombre exacto. */
  readonly actor?: { readonly kind: "agente" } | { readonly kind: "humano"; readonly name: string };
  readonly limit?: number;
};

/** Eventos de la organización, más recientes primero, con filtros opcionales. */
export async function listEvents(
  exec: Executor,
  organizationId: Ulid,
  filter: EventFilter = {},
): Promise<AuditEvent[]> {
  const { actor } = filter;
  const rows = await exec.query.auditEvents.findMany({
    where: and(
      eq(auditEvents.organizationId, organizationId),
      filter.invoiceId === undefined ? undefined : eq(auditEvents.invoiceId, filter.invoiceId),
      filter.type === undefined ? undefined : eq(auditEvents.type, filter.type),
      filter.excludeTypes === undefined || filter.excludeTypes.length === 0
        ? undefined
        : notInArray(auditEvents.type, [...filter.excludeTypes]),
      actor === undefined
        ? undefined
        : actor.kind === "agente"
          ? sql`json_extract(${auditEvents.actor}, '$.kind') = 'agente'`
          : sql`json_extract(${auditEvents.actor}, '$.name') = ${actor.name}`,
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

export type EventCounts = {
  readonly total: number;
  /** Decisiones del agente: pagar, frenar o escalar. */
  readonly decisions: number;
  /** Lo que hicieron personas: aprobar, rechazar, corregir, firmar, cambiar interruptores. */
  readonly byPeople: number;
};

/** Cuántos eventos tiene la organización, en una sola lectura. */
export async function countEvents(exec: Executor, organizationId: Ulid): Promise<EventCounts> {
  const [row] = await exec
    .select({
      total: sql<number>`count(*)`,
      decisions: sql<number>`coalesce(sum(case when ${auditEvents.type} in ('invoice.decided', 'invoice.escalated') then 1 else 0 end), 0)`,
      byPeople: sql<number>`coalesce(sum(case when json_extract(${auditEvents.actor}, '$.kind') = 'humano' then 1 else 0 end), 0)`,
    })
    .from(auditEvents)
    .where(eq(auditEvents.organizationId, organizationId));
  return {
    total: Number(row?.total ?? 0),
    decisions: Number(row?.decisions ?? 0),
    byPeople: Number(row?.byPeople ?? 0),
  };
}
