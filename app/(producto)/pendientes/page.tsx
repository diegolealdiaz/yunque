import Link from "next/link";

import { formatMoney } from "@/src/domain";
import { calendarDate, dueRelative } from "@/src/ui/format";
import type { InboxRow } from "@/src/usecases";

import { DataTable } from "../../_components/data-table";
import { AlertIcon, ChevronIcon } from "../../_components/icons";
import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";
import { VerdictChip } from "../../_components/verdict-chip";
import { inboxView } from "../../_data/inbox";

export const metadata = { title: "Pendientes · Yunque" };

/**
 * Pendientes, la pantalla de inicio (docs/interfaz.md §5.1). Excepciones primero: lo que
 * espera a una persona ocupa el espacio, ordenado por vencimiento; lo frenado se muestra
 * para que nadie se sorprenda; lo pagado se colapsa en una línea.
 */

function invoiceHref(row: InboxRow): string {
  return `/facturas/${row.invoiceId}`;
}

function SectionTitle({ title, count, note }: { title: string; count: number; note?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="text-[12px] font-semibold tracking-wide text-ink-2 uppercase">
        {title} <span className="num">({count})</span>
      </h2>
      {note ? <span className="text-[12px] text-ink-3">{note}</span> : null}
    </div>
  );
}

export default async function PendientesPage() {
  const inbox = await inboxView();
  const waiting = inbox.waiting.length;
  const resolvedToday = inbox.paid.length + inbox.stopped.length;

  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader
        title="Pendientes"
        meta={
          <span>
            Hoy, {calendarDate(inbox.today)} ·{" "}
            {waiting === 1 ? "1 espera tu decisión" : `${String(waiting)} esperan tu decisión`}
          </span>
        }
      />

      <section aria-labelledby="esperan">
        <div id="esperan">
          <SectionTitle title="Esperan tu decisión" count={waiting} />
        </div>
        <DataTable
          caption="Facturas que esperan tu decisión, por vencimiento"
          columns={[
            { header: "Estado", hideHeader: true, width: "2rem" },
            { header: "Beneficiario" },
            { header: "Monto", align: "right", width: "11rem" },
            { header: "Vence", width: "10rem" },
            { header: "Veredicto", width: "20rem" },
            { header: "Acción", hideHeader: true, width: "6rem" },
          ]}
          rows={inbox.waiting.map((row) => ({
            key: row.invoiceId,
            href: invoiceHref(row),
            cells: [
              <AlertIcon key="i" className="text-escalate-solid" />,
              <span key="p" className="font-medium">
                {row.payeeName ?? "Sin beneficiario leído"}
                <span className="ml-2 font-mono text-[12px] text-ink-3">{row.reference}</span>
              </span>,
              <span key="a" className="font-mono">
                {row.amount ? formatMoney(row.amount) : "sin monto"}
              </span>,
              <span key="d" className={row.expired ? "font-medium text-ink" : "text-ink-2"}>
                {row.expired ? "espera vencida" : dueRelative(row.dueDate, inbox.today)}
              </span>,
              <VerdictChip
                key="v"
                verdict={row.verdict}
                rule={row.rule}
                policyVersion={row.policyVersion}
              />,
              <Link
                key="l"
                href={invoiceHref(row)}
                className="inline-flex items-center gap-1 font-medium text-ink"
              >
                Revisar
                <ChevronIcon />
              </Link>,
            ],
          }))}
          empty={
            <EmptyState
              title={
                resolvedToday === 0
                  ? "Nada pendiente."
                  : `Nada pendiente. El agente resolvió ${String(resolvedToday)} ${resolvedToday === 1 ? "factura" : "facturas"} hoy.`
              }
              action={
                resolvedToday > 0 ? { label: "Ver las facturas de hoy", href: "/facturas" } : null
              }
            />
          }
        />
      </section>

      <section aria-labelledby="frenadas">
        <div id="frenadas">
          <SectionTitle title="Frenadas" count={inbox.stopped.length} note="el agente las detuvo" />
        </div>
        {inbox.stopped.length === 0 ? (
          <p className="text-[13px] text-ink-3">Ninguna factura frenada hoy.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
            {inbox.stopped.map((row) => (
              <li key={row.invoiceId}>
                <Link
                  href={invoiceHref(row)}
                  className="flex h-[var(--row-height)] items-center gap-3 px-3 text-[13px] hover:bg-surface-hover"
                >
                  <VerdictChip
                    verdict={row.verdict}
                    rule={row.rule}
                    policyVersion={row.policyVersion}
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {row.payeeName ?? "Sin beneficiario leído"}
                  </span>
                  <span className="font-mono text-ink-2">
                    {row.amount ? formatMoney(row.amount) : ""}
                  </span>
                  <span className="text-ink-3">ver</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pagadas">
        <div id="pagadas">
          <SectionTitle
            title="Pagadas por el agente hoy"
            count={inbox.paid.length}
            note="dentro de las reglas"
          />
        </div>
        {inbox.paid.length === 0 ? (
          <p className="text-[13px] text-ink-3">El agente no pagó ninguna factura hoy.</p>
        ) : (
          <Link
            href="/facturas?veredicto=pagar"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-ink underline underline-offset-4"
          >
            Ver las {inbox.paid.length}
            <ChevronIcon />
          </Link>
        )}
      </section>
    </div>
  );
}
