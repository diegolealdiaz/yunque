import type { Database } from "@/src/db/client";
import {
  findInvoiceByReference,
  getCurrentPolicy,
  listEvents,
  listInvoicesByIds,
} from "@/src/db/repositories";
import { UlidSchema, type AuditEvent, type EventType, type Ulid } from "@/src/domain";

/**
 * Bitácora (docs/interfaz.md §5.6): la tabla de auditoría tal cual, la más reciente primero,
 * con filtro por tipo, factura y persona. Cada evento lleva la referencia de su factura para
 * enlazarla. No se resume ni se transforma: lo que se ve es lo que quedó escrito.
 */

/** Cuántos eventos trae cada página, y el máximo que se lee de una vez. */
export const AUDIT_PAGE = 100;
export const AUDIT_MAX = 1000;

export type AuditLogFilter = {
  readonly type?: EventType;
  /** Referencia (`YQ-2026-10-0001`) o id de la factura. */
  readonly invoice?: string;
  /** `agente`, o el nombre de una persona. */
  readonly person?: string;
  readonly limit?: number;
};

export type AuditLogEntry = {
  readonly event: AuditEvent;
  /** Referencia de la factura del evento; null si el evento no es de una factura. */
  readonly invoiceReference: string | null;
};

export type AuditLog = {
  readonly entries: readonly AuditLogEntry[];
  /** Hay más eventos con esos filtros que los que se leyeron. */
  readonly hasMore: boolean;
  /** Se pidió una factura que esta empresa no tiene. */
  readonly invoiceNotFound: boolean;
  /** Personas por las que se puede filtrar: los aprobadores de la política vigente. */
  readonly people: readonly string[];
};

async function resolveInvoice(
  db: Database,
  organizationId: Ulid,
  invoice: string,
): Promise<Ulid | null> {
  const text = invoice.trim();
  const id = UlidSchema.safeParse(text);
  if (id.success) {
    const [found] = await listInvoicesByIds(db, organizationId, [id.data]);
    if (found) return found.id;
  }
  return (await findInvoiceByReference(db, organizationId, text.toUpperCase()))?.id ?? null;
}

export async function loadAuditLog(
  db: Database,
  organizationId: Ulid,
  filter: AuditLogFilter,
): Promise<AuditLog> {
  const limit = Math.min(Math.max(1, filter.limit ?? AUDIT_PAGE), AUDIT_MAX);
  const policy = await getCurrentPolicy(db, organizationId);
  const people = policy?.content.protected.approvers ?? [];

  let invoiceId: Ulid | undefined;
  if (filter.invoice) {
    const resolved = await resolveInvoice(db, organizationId, filter.invoice);
    if (resolved === null) {
      return { entries: [], hasMore: false, invoiceNotFound: true, people };
    }
    invoiceId = resolved;
  }

  // Uno de más para saber si hay otra página sin contar toda la tabla.
  const events = await listEvents(db, organizationId, {
    ...(invoiceId ? { invoiceId } : {}),
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.person
      ? {
          actor:
            filter.person === "agente"
              ? { kind: "agente" as const }
              : { kind: "humano" as const, name: filter.person },
        }
      : {}),
    limit: limit + 1,
  });
  const page = events.slice(0, limit);
  const invoiceIds = [...new Set(page.flatMap((e) => (e.invoice_id ? [e.invoice_id] : [])))];
  const references = new Map(
    (await listInvoicesByIds(db, organizationId, invoiceIds)).map((i) => [i.id, i.reference]),
  );
  return {
    entries: page.map((event) => ({
      event,
      invoiceReference: event.invoice_id ? (references.get(event.invoice_id) ?? null) : null,
    })),
    hasMore: events.length > limit,
    invoiceNotFound: false,
    people,
  };
}
