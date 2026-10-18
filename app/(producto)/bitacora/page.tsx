import Link from "next/link";
import { z } from "zod";

import { EventTypeSchema, type AuditEvent, type EventType } from "@/src/domain";
import { STEP_EVENTS, describeEvent, type AuditTone } from "@/src/ui/audit";
import { auditInstant, eventData } from "@/src/ui/format";
import { EVENT_LABEL } from "@/src/ui/labels";
import { AUDIT_MAX, AUDIT_PAGE, loadAuditLog } from "@/src/usecases";

import { DataTable } from "../../_components/data-table";
import { LockIcon } from "../../_components/icons";
import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";
import { appContext } from "../../_data/context";

export const metadata = { title: "Bitácora · Yunque" };

/**
 * Bitácora (docs/interfaz.md §5.6): los eventos de dominio en orden, el más reciente
 * primero. Cada evento dice quién, cuándo y qué pasó en una frase, con el porqué al lado, y
 * enlaza a su factura. Por defecto se ven las decisiones y lo que hicieron las personas; los
 * pasos internos de cada factura se ven con "Todos los pasos". Los datos crudos quedan para
 * quien audita, con "Datos técnicos". Los filtros viven en la URL, así el detalle de una
 * factura puede enlazar a su bitácora.
 */

const FiltersSchema = z.object({
  tipo: EventTypeSchema.optional().catch(undefined),
  factura: z.string().trim().min(1).max(60).optional().catch(undefined),
  persona: z.string().trim().min(1).max(200).optional().catch(undefined),
  pasos: z.literal("todos").optional().catch(undefined),
  tecnico: z.literal("1").optional().catch(undefined),
  n: z.coerce.number().int().min(AUDIT_PAGE).max(AUDIT_MAX).optional().catch(undefined),
});
type Filters = z.infer<typeof FiltersSchema>;

const EVENT_TYPES: readonly EventType[] = EventTypeSchema.options;

const control =
  "h-9 rounded-[var(--radius-control)] border border-transparent bg-surface-sunken px-2.5 text-[13px] text-ink hover:border-control focus:border-control";

/** La misma URL con los filtros actuales y otros valores. */
function hrefWith(filters: Filters, change: Partial<Filters>): string {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query === "" ? "/bitacora" : `/bitacora?${query}`;
}

const DOT: Readonly<Record<AuditTone, string>> = {
  pay: "bg-pay-solid",
  hold: "bg-hold-solid",
  escalate: "bg-escalate-solid",
  brand: "bg-brand",
  neutral: "bg-line-strong",
};

/** Iniciales de quien actuó, en un círculo: el agente con el color de la marca. */
function Actor({ actor }: { readonly actor: AuditEvent["actor"] }) {
  const agent = actor.kind === "agente";
  const name = agent ? "El agente" : actor.name;
  const initials = agent
    ? "AG"
    : name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("");
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`grid size-7 shrink-0 place-items-center rounded-full font-mono text-[10px] font-semibold ${
          agent ? "bg-brand-tint text-brand" : "bg-surface-sunken text-ink-2"
        }`}
      >
        {initials}
      </span>
      <span className={agent ? "text-ink-2" : "font-medium text-ink"}>{name}</span>
    </span>
  );
}

/** Una cifra del resumen: nombre en mayúsculas pequeñas y valor en mono. */
function Count({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="min-w-0">
      <p className="caps">{label}</p>
      <p className="mt-1 font-mono text-[20px] text-ink">{value.toLocaleString("es-CO")}</p>
    </div>
  );
}

/** Cambia entre ver solo lo que importa y ver cada paso. */
function Scope({ filters }: { readonly filters: Filters }) {
  const options = [
    { label: "Decisiones y acciones", value: undefined },
    { label: "Todos los pasos", value: "todos" as const },
  ];
  return (
    <nav
      aria-label="Qué eventos ver"
      className="inline-flex rounded-[var(--radius-control)] bg-surface-sunken p-0.5"
    >
      {options.map((option) => {
        const current = filters.pasos === option.value;
        return (
          <Link
            key={option.label}
            href={hrefWith(filters, { pasos: option.value, n: undefined })}
            aria-current={current ? "page" : undefined}
            className={`rounded-[3px] px-3 py-1.5 text-[13px] font-medium ${
              current ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
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
    ...(filters.pasos === "todos" ? {} : { exclude: STEP_EVENTS }),
    limit,
  });
  const filtered = Boolean(filters.tipo || filters.factura || filters.persona);
  const technical = filters.tecnico === "1";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Bitácora"
        actions={
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
            <LockIcon />
            Nadie puede editar ni borrar un evento
          </span>
        }
      />

      <section
        aria-label="Resumen de la bitácora"
        className="grid gap-5 card px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
      >
        <div>
          <p className="caps">Eventos registrados</p>
          <p className="mt-1 font-mono text-[34px] leading-tight font-medium text-ink">
            {log.counts.total.toLocaleString("es-CO")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 sm:gap-10">
          <Count label="Decisiones del agente" value={log.counts.decisions} />
          <Count label="Acciones de personas" value={log.counts.byPeople} />
        </div>
      </section>

      <p className="max-w-[60rem] text-[13px] leading-relaxed text-ink-2">
        Todo lo que hacen el agente y tu equipo queda escrito aquí, en orden: qué se decidió, por
        qué, y quién aprobó, rechazó o cambió una regla. Abre una fila para ver su factura.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Scope filters={filters} />
        <form className="flex flex-wrap items-center gap-2" role="search">
          {filters.pasos ? <input type="hidden" name="pasos" value={filters.pasos} /> : null}
          {technical ? <input type="hidden" name="tecnico" value="1" /> : null}
          <label>
            <span className="sr-only">Factura</span>
            <input
              name="factura"
              type="search"
              defaultValue={filters.factura ?? ""}
              placeholder="Referencia de factura"
              className={`${control} w-48 font-mono placeholder:font-sans placeholder:text-ink-3`}
            />
          </label>
          <label>
            <span className="sr-only">Quién</span>
            <select name="persona" defaultValue={filters.persona ?? ""} className={control}>
              <option value="">Cualquiera</option>
              <option value="agente">El agente</option>
              {log.people.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Tipo de evento</span>
            <select name="tipo" defaultValue={filters.tipo ?? ""} className={`${control} w-52`}>
              <option value="">Todo tipo</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EVENT_LABEL[type]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-9 rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium text-ink"
          >
            Filtrar
          </button>
          {filtered ? (
            <Link
              href={hrefWith(filters, { tipo: undefined, factura: undefined, persona: undefined })}
              className="px-1 text-[13px] text-ink-2 underline underline-offset-4"
            >
              Quitar filtros
            </Link>
          ) : null}
        </form>
        <Link
          href={hrefWith(filters, { tecnico: technical ? undefined : "1" })}
          aria-pressed={technical}
          className="ml-auto text-[13px] text-ink-2 underline-offset-4 hover:text-ink hover:underline"
        >
          {technical ? "Ocultar datos técnicos" : "Ver datos técnicos"}
        </Link>
      </div>

      <DataTable
        spacious
        caption="Eventos de la bitácora, el más reciente primero"
        columns={[
          { header: "Cuándo", width: "9.5rem", card: "aside" },
          { header: "Quién", width: "11rem", from: "xl" },
          { header: "Qué pasó", flexible: true, card: "title" },
          { header: "Factura", width: "15rem" },
        ]}
        rows={log.entries.map(({ event, invoiceReference, payeeName }) => {
          const line = describeEvent(event.type, event.data);
          const [day, time] = auditInstant(event.occurred_at, config.displayTimeZone).split(", ");
          return {
            key: event.id,
            label: `${line.title}${invoiceReference ? ` · ${invoiceReference}` : ""}`,
            ...(event.invoice_id ? { href: `/facturas/${event.invoice_id}` } : {}),
            cells: [
              <span key="t" className="flex flex-col font-sans">
                <span className="font-mono text-ink">{time}</span>
                <span className="text-[12px] text-ink-3">{day}</span>
              </span>,
              <Actor key="a" actor={event.actor} />,
              <span key="w" className="flex min-w-0 items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[line.tone]}`}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium whitespace-normal text-ink">{line.title}</span>
                  {line.detail ? (
                    <span className="text-[12px] leading-snug whitespace-normal text-ink-2">
                      {line.detail}
                    </span>
                  ) : null}
                  {technical ? (
                    <span
                      title={eventData(event.data)}
                      className="truncate font-mono text-[11px] text-ink-3"
                    >
                      {event.type} · {eventData(event.data)}
                    </span>
                  ) : null}
                </span>
              </span>,
              invoiceReference ? (
                <span key="f" className="flex min-w-0 flex-col font-sans">
                  <span className="truncate text-ink">{payeeName ?? "Sin beneficiario leído"}</span>
                  <span className="font-mono text-[12px] text-ink-3">{invoiceReference}</span>
                </span>
              ) : (
                <span key="f" className="font-sans text-ink-3">
                  —
                </span>
              ),
            ],
          };
        })}
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
            href={hrefWith(filters, { n: Math.min(limit + AUDIT_PAGE, AUDIT_MAX) })}
            className="text-[13px] text-ink-2 underline underline-offset-4"
          >
            Ver {AUDIT_PAGE} eventos más
          </Link>
        </p>
      ) : null}
    </div>
  );
}
