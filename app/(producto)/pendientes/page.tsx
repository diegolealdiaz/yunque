import Link from "next/link";

import { formatMoney } from "@/src/domain";
import { calendarDate, dueRelative } from "@/src/ui/format";
import type { InboxRow } from "@/src/usecases";

import { DataTable } from "../../_components/data-table";
import { AlertIcon, ChevronIcon } from "../../_components/icons";
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
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="flex items-baseline gap-2.5 text-[18px] font-semibold tracking-tight text-ink">
        {title}
        <span className="num font-mono text-[13px] font-normal text-ink-3">{count}</span>
      </h2>
      {note ? <span className="text-[13px] text-ink-3">{note}</span> : null}
    </div>
  );
}

/** Una línea del desglose: etiqueta a la izquierda, cifra en mono a la derecha. */
function LedgerLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-10 items-center justify-between gap-4 border-b border-line last:border-b-0">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="num font-mono text-[13px] text-ink">{value}</dd>
    </div>
  );
}

export default async function PendientesPage() {
  const inbox = await inboxView();
  const waiting = inbox.waiting.length;
  const resolvedToday = inbox.paid.length + inbox.stopped.length;
  const first = inbox.waiting[0];

  return (
    <div className="space-y-8">
      {/* La cifra principal de la pantalla: cuántas esperan a una persona. */}
      <header className="flex flex-col gap-6 border-b border-line pb-7 md:flex-row md:items-end md:gap-14">
        <div className="shrink-0">
          <p className="caps">Pendientes · hoy, {calendarDate(inbox.today)}</p>
          <h1 className="mt-2 flex items-baseline gap-3.5">
            <span className="hero-figure num font-mono text-[64px] leading-[68px] font-bold tracking-tight">
              {waiting}
            </span>
            <span className="text-[18px] font-medium text-ink-2">
              {waiting === 1 ? "espera tu decisión" : "esperan tu decisión"}
            </span>
          </h1>
          {first ? (
            <p className="mt-1.5 text-[13px] text-ink-3">
              La más urgente:{" "}
              {first.expired ? "espera vencida" : dueRelative(first.dueDate, inbox.today)}.
            </p>
          ) : null}
        </div>
        <dl className="w-full md:max-w-md md:flex-1">
          <LedgerLine label="Pagadas hoy por el agente" value={String(inbox.paid.length)} />
          <LedgerLine label="Frenadas hoy" value={String(inbox.stopped.length)} />
        </dl>
      </header>

      <section aria-labelledby="esperan" data-tour="pendientes">
        <div id="esperan">
          <SectionTitle title="Esperan tu decisión" count={waiting} />
        </div>
        <DataTable
          caption="Facturas que esperan tu decisión, por vencimiento"
          columns={[
            { header: "Estado", hideHeader: true, width: "2.5rem", card: "hidden" },
            { header: "Beneficiario", flexible: true, card: "title" },
            { header: "Monto", align: "right", width: "11rem", card: "aside" },
            { header: "Vence", width: "10.5rem", from: "xl" },
            { header: "Veredicto", width: "20.5rem" },
            { header: "Acción", hideHeader: true, width: "6.5rem", card: "hidden" },
          ]}
          rows={inbox.waiting.map((row) => ({
            key: row.invoiceId,
            href: invoiceHref(row),
            label: row.reference,
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
            inbox.demo && resolvedToday === 0 ? (
              <EmptyState
                title="Hoy todavía no llega ninguna factura."
                detail="Procesa el periodo de ejemplo para ver al agente pagar, frenar y escalar dentro de las reglas."
                action={{ label: "Ir a Facturas y procesar las de ejemplo", href: "/facturas" }}
              />
            ) : (
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
            )
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
          <ul className="card divide-y divide-line overflow-hidden">
            {inbox.stopped.map((row) => (
              <li key={row.invoiceId}>
                <Link
                  href={invoiceHref(row)}
                  className="flex h-[var(--row-height)] items-center gap-3 px-4 text-[13px] hover:bg-surface-hover"
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
            href="/facturas?veredicto=pagar&dia=hoy"
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
