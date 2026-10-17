import Link from "next/link";
import { z } from "zod";

import { EventTypeSchema, type EventType } from "@/src/domain";
import { auditInstant, eventData } from "@/src/ui/format";
import { EVENT_LABEL } from "@/src/ui/labels";
import { AUDIT_MAX, AUDIT_PAGE, loadAuditLog } from "@/src/usecases";

import { DataTable } from "../../_components/data-table";
import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";
import { appContext } from "../../_data/context";

export const metadata = { title: "Bitácora · Yunque" };

/**
 * Bitácora (docs/interfaz.md §5.6): los eventos de dominio en orden, el más reciente
 * primero, con filtro por tipo, factura y persona. Cada evento dice quién, cuándo, qué y
 * enlaza a su factura. Es la tabla de auditoría sin transformar: los datos se muestran tal
 * como quedaron escritos. Los filtros viven en la URL, así el detalle de una factura puede
 * enlazar a su bitácora.
 */

const FiltersSchema = z.object({
  tipo: EventTypeSchema.optional().catch(undefined),
  factura: z.string().trim().min(1).max(60).optional().catch(undefined),
  persona: z.string().trim().min(1).max(200).optional().catch(undefined),
  n: z.coerce.number().int().min(AUDIT_PAGE).max(AUDIT_MAX).optional().catch(undefined),
});

const EVENT_TYPES: readonly EventType[] = EventTypeSchema.options;

const field = "flex flex-col gap-1 text-[12px] text-ink-3";
const control =
  "h-8 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-[13px] text-ink";

/** La misma URL con los filtros actuales y otro tamaño de página. */
function moreHref(filters: z.infer<typeof FiltersSchema>, limit: number): string {
  const params = new URLSearchParams();
  if (filters.tipo) params.set("tipo", filters.tipo);
  if (filters.factura) params.set("factura", filters.factura);
  if (filters.persona) params.set("persona", filters.persona);
  params.set("n", String(limit));
  return `/bitacora?${params.toString()}`;
}

export default async function BitacoraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = FiltersSchema.parse(await searchParams);
  const { config, db, organization } = await appContext();
  const limit = filters.n ?? AUDIT_PAGE;
  const log = await loadAuditLog(db, organization.id, {
    ...(filters.tipo ? { type: filters.tipo } : {}),
    ...(filters.factura ? { invoice: filters.factura } : {}),
    ...(filters.persona ? { person: filters.persona } : {}),
    limit,
  });
  const filtered = Boolean(filters.tipo || filters.factura || filters.persona);

  return (
    <div className="max-w-7xl space-y-6">
      <PageHeader
        title="Bitácora"
        meta={
          <span>
            {log.entries.length}
            {log.hasMore ? "+" : ""}{" "}
            {log.entries.length === 1 && !log.hasMore ? "evento" : "eventos"}
          </span>
        }
      />

      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className={field}>
          Tipo
          <select name="tipo" defaultValue={filters.tipo ?? ""} className={control}>
            <option value="">Todos</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVENT_LABEL[type]}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Factura
          <input
            name="factura"
            type="search"
            defaultValue={filters.factura ?? ""}
            placeholder="YQ-2026-10-0001"
            className={`${control} w-48 font-mono placeholder:font-sans placeholder:text-ink-3`}
          />
        </label>
        <label className={field}>
          Persona
          <select name="persona" defaultValue={filters.persona ?? ""} className={control}>
            <option value="">Todas</option>
            <option value="agente">El agente</option>
            {log.people.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium text-ink"
        >
          Filtrar
        </button>
        {filtered ? (
          <Link
            href="/bitacora"
            className="h-8 content-center text-[13px] text-ink-2 underline underline-offset-4"
          >
            Quitar filtros
          </Link>
        ) : null}
      </form>

      <DataTable
        caption="Eventos de la bitácora, el más reciente primero"
        columns={[
          { header: "Cuándo", width: "12rem" },
          { header: "Quién", width: "9rem" },
          { header: "Qué", width: "15rem" },
          { header: "Factura", width: "10rem" },
          { header: "Datos" },
        ]}
        rows={log.entries.map(({ event, invoiceReference }) => ({
          key: event.id,
          ...(event.invoice_id ? { href: `/facturas/${event.invoice_id}` } : {}),
          cells: [
            <span key="t" className="num text-ink-2">
              {auditInstant(event.occurred_at, config.displayTimeZone)}
            </span>,
            <span key="a" className={event.actor.kind === "agente" ? "text-ink-2" : "font-medium"}>
              {event.actor.kind === "agente" ? "El agente" : event.actor.name}
            </span>,
            <span key="w" className="flex flex-col">
              <span>{EVENT_LABEL[event.type]}</span>
              <span className="font-mono text-[11px] text-ink-3">{event.type}</span>
            </span>,
            <span key="f" className="font-mono text-[12px]">
              {invoiceReference ?? <span className="font-sans text-ink-3">—</span>}
            </span>,
            <span
              key="d"
              title={eventData(event.data)}
              className="block max-w-[36rem] truncate font-mono text-[12px] text-ink-2"
            >
              {eventData(event.data)}
            </span>,
          ],
        }))}
        empty={
          <EmptyState
            title={
              log.invoiceNotFound
                ? "No hay una factura con esa referencia."
                : filtered
                  ? "Ningún evento con esos filtros."
                  : "Todavía no hay eventos."
            }
            detail={
              log.invoiceNotFound ? "Revisa la referencia, por ejemplo YQ-2026-10-0001." : null
            }
            action={filtered ? { label: "Quitar filtros", href: "/bitacora" } : null}
          />
        }
      />

      {log.hasMore && limit < AUDIT_MAX ? (
        <p>
          <Link
            href={moreHref(filters, Math.min(limit + AUDIT_PAGE, AUDIT_MAX))}
            className="text-[13px] text-ink-2 underline underline-offset-4"
          >
            Ver {AUDIT_PAGE} eventos más
          </Link>
        </p>
      ) : null}
    </div>
  );
}
