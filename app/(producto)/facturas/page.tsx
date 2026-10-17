import Link from "next/link";
import { z } from "zod";

import { loadBatchCases } from "@/src/dataset/demo-seed";
import { loadMailbox } from "@/src/dataset/mailbox";
import {
  ChannelSchema,
  InvoiceStatusSchema,
  VerdictSchema,
  formatMoney,
  type Channel,
  type InvoiceStatus,
  type Verdict,
} from "@/src/domain";
import { dueRelative, instant, relativeInstant } from "@/src/ui/format";
import { CHANNEL_LABEL, STATUS_LABEL } from "@/src/ui/labels";
import {
  LIST_LIMIT,
  currentBusinessDate,
  startOfBusinessDay,
  activeAccess,
  loadInboundAddress,
  loadTelegramStatus,
  loadInvoiceList,
} from "@/src/usecases";

import { DataTable } from "../../_components/data-table";
import { PageHeader } from "../../_components/page-header";
import { ActionDialog } from "../../_components/action-dialog";
import { CloseIcon } from "../../_components/icons";
import { StatusBadge } from "../../_components/status-badge";
import { EmptyState } from "../../_components/states";
import { VerdictChip } from "../../_components/verdict-chip";
import { appContext } from "../../_data/context";

import { DeliveryRunner } from "./delivery-runner";
import { AccessPanel, type ClientAccess } from "./access-panel";
import { UploadPanel } from "./upload-panel";

export const metadata = { title: "Facturas · Yunque" };

/**
 * Facturas (docs/interfaz.md §5.3): el archivo completo, con filtros por veredicto, estado,
 * canal y texto, y los caminos de entrada de la pantalla: subir archivos y, en la demo,
 * procesar las facturas de ejemplo, revisar el correo de ejemplo y probar con una factura
 * propia por correo o Telegram (D23, D24). Los filtros viven en la URL, así un enlace (como "Ver las 15" de Pendientes) abre
 * la lista ya filtrada.
 */

const FiltersSchema = z.object({
  veredicto: VerdictSchema.optional().catch(undefined),
  estado: InvoiceStatusSchema.optional().catch(undefined),
  canal: ChannelSchema.optional().catch(undefined),
  q: z.string().max(100).optional().catch(undefined),
  /** "hoy": solo las decididas hoy, como las cuenta Pendientes. */
  dia: z.literal("hoy").optional().catch(undefined),
});

type Filters = z.infer<typeof FiltersSchema>;
const STATUSES: readonly InvoiceStatus[] = [
  "esperando_aprobacion",
  "decidida",
  "aprobada",
  "rechazada",
  "procesando",
  "fallida",
];
const CHANNELS: readonly Channel[] = ["upload", "batch", "inbox", "telegram", "api"];

function Select<T extends string>({
  name,
  label,
  value,
  options,
  labelOf,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: T | undefined;
  readonly options: readonly T[];
  readonly labelOf: (option: T) => string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-ink-3">
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        className="h-8 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-[13px] text-ink"
      >
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labelOf(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Atajos por veredicto, en píldoras: el filtro más usado a un clic, sin abrir el formulario. */
const VERDICT_PILLS: readonly { verdict: Verdict | null; label: string; dot: string | null }[] = [
  { verdict: null, label: "Todas", dot: null },
  { verdict: "pagar", label: "Pagadas", dot: "bg-pay-solid" },
  { verdict: "escalar", label: "Escaladas", dot: "bg-escalate-solid" },
  { verdict: "frenar", label: "Frenadas", dot: "bg-hold-solid" },
];

/** Enlace a la lista con un veredicto, conservando los demás filtros. */
function verdictHref(filters: Filters, verdict: Verdict | null): string {
  const params = new URLSearchParams();
  if (verdict) params.set("veredicto", verdict);
  if (filters.estado) params.set("estado", filters.estado);
  if (filters.canal) params.set("canal", filters.canal);
  if (filters.q) params.set("q", filters.q);
  if (filters.dia) params.set("dia", filters.dia);
  const query = params.toString();
  return query ? `/facturas?${query}` : "/facturas";
}

export default async function FacturasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = FiltersSchema.parse(await searchParams);
  const { config, db, organization } = await appContext();
  const now = new Date();
  const today = currentBusinessDate(
    { demo: config.demo.enabled, timeZone: config.displayTimeZone },
    now,
  );
  const inbound = config.demo.enabled ? config.inboundEmail : null;
  const telegram = config.demo.enabled ? config.telegram : null;
  const accessEnabled = config.demo.enabled && config.access !== null;
  const [rows, batch, mailbox, grant, emailAddress, telegramStatus] = await Promise.all([
    loadInvoiceList(
      db,
      organization.id,
      {
        ...(filters.veredicto ? { verdict: filters.veredicto } : {}),
        ...(filters.estado ? { status: filters.estado } : {}),
        ...(filters.canal ? { channel: filters.canal } : {}),
        ...(filters.q ? { query: filters.q } : {}),
        ...(filters.dia
          ? { decidedSince: startOfBusinessDay(now, config.displayTimeZone).toISOString() }
          : {}),
      },
      now,
    ),
    config.demo.enabled ? loadBatchCases() : Promise.resolve([]),
    config.demo.enabled ? loadMailbox() : Promise.resolve([]),
    accessEnabled ? activeAccess(db, organization.id, now) : null,
    inbound ? loadInboundAddress(db, organization.id, inbound.address, now) : null,
    telegram ? loadTelegramStatus(db, organization.id) : null,
  ]);
  const clientAccess: ClientAccess = {
    expires: grant ? instant(grant.expiresAt, config.displayTimeZone) : null,
    email: inbound
      ? { address: emailAddress?.address ?? null, maxPerDay: inbound.maxPerAddressPerDay }
      : null,
    telegram:
      telegram && telegramStatus
        ? { chats: telegramStatus.chats, maxPerDay: telegram.maxPerChatPerDay }
        : null,
  };
  const filtered = Boolean(
    filters.veredicto || filters.estado || filters.canal || filters.q || filters.dia,
  );

  return (
    <div className="flex flex-col gap-4 lg:h-full">
      <PageHeader
        title="Facturas"
        meta={
          <span>
            {rows.length === LIST_LIMIT ? `${String(LIST_LIMIT)}+` : rows.length}{" "}
            {rows.length === 1 ? "factura" : "facturas"}
          </span>
        }
        actions={
          <>
            <ActionDialog label="Subir factura" primary={!config.demo.enabled}>
              <UploadPanel maxBytes={config.demo.maxUploadBytes} />
            </ActionDialog>
            {accessEnabled && (inbound || telegram) ? (
              <ActionDialog label="Probar con tu factura">
                <AccessPanel access={clientAccess} />
              </ActionDialog>
            ) : null}
            {config.demo.enabled ? (
              <>
                <DeliveryRunner
                  endpoint="/api/bandeja"
                  field="mensaje"
                  ids={mailbox.map((m) => m.id)}
                  label={`Revisar correo de ejemplo (${String(mailbox.length)})`}
                  noun="correos"
                />
                <DeliveryRunner
                  endpoint="/api/lote"
                  field="caso"
                  ids={batch.map((c) => c.id)}
                  label={`Procesar facturas de ejemplo (${String(batch.length)})`}
                  noun="facturas"
                  primary
                />
              </>
            ) : null}
          </>
        }
      />

      {config.demo.enabled ? (
        <p className="-mt-2 text-[12px] text-ink-3">
          Demo: los botones de ejemplo simulan las facturas que llegan en una quincena por PDF,
          foto, correo y chat.
          {accessEnabled && (inbound || telegram)
            ? " Con «Probar con tu factura» puedes enviar una real."
            : ""}
        </p>
      ) : null}

      <nav aria-label="Filtrar por veredicto">
        <ul className="flex flex-wrap gap-1.5">
          {VERDICT_PILLS.map(({ verdict, label, dot }) => {
            const active = (filters.veredicto ?? null) === verdict;
            return (
              <li key={label}>
                <Link
                  href={verdictHref(filters, verdict)}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] ${
                    active
                      ? "bg-surface-hover font-semibold text-ink"
                      : "text-ink-2 hover:bg-surface-hover hover:text-ink"
                  }`}
                >
                  {dot ? (
                    <span aria-hidden="true" className={`size-[7px] rounded-full ${dot}`} />
                  ) : null}
                  {label}
                </Link>
              </li>
            );
          })}
          {filters.dia ? (
            <li>
              <Link
                href={verdictHref({ ...filters, dia: undefined }, filters.veredicto ?? null)}
                aria-label="Quitar el filtro: decididas hoy"
                className="inline-flex h-8 items-center gap-2 rounded-full border border-line-strong px-3.5 text-[13px] text-ink hover:bg-surface-hover"
              >
                Decididas hoy
                <CloseIcon />
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>

      <form className="flex flex-wrap items-end gap-3" role="search">
        {filters.veredicto ? (
          <input type="hidden" name="veredicto" value={filters.veredicto} />
        ) : null}
        {filters.dia ? <input type="hidden" name="dia" value={filters.dia} /> : null}
        <label className="flex flex-col gap-1 text-[12px] text-ink-3">
          Buscar
          <input
            name="q"
            type="search"
            data-shortcut="buscar"
            defaultValue={filters.q ?? ""}
            placeholder="Beneficiario o referencia ( / )"
            className="h-8 w-64 rounded-[var(--radius-control)] border border-control bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3"
          />
        </label>
        <Select
          name="estado"
          label="Estado"
          value={filters.estado}
          options={STATUSES}
          labelOf={(s) => STATUS_LABEL[s]}
        />
        <Select
          name="canal"
          label="Canal"
          value={filters.canal}
          options={CHANNELS}
          labelOf={(c) => CHANNEL_LABEL[c]}
        />
        <button
          type="submit"
          className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium text-ink"
        >
          Filtrar
        </button>
        {filtered ? (
          <Link
            href="/facturas"
            className="h-8 content-center text-[13px] text-ink-2 underline underline-offset-4"
          >
            Quitar filtros
          </Link>
        ) : null}
      </form>

      <DataTable
        fill
        caption="Facturas, las más recientes primero"
        columns={[
          { header: "Estado", width: "9.5rem", from: "2xl" },
          { header: "Referencia", width: "10rem", from: "xl", card: "line" },
          { header: "Beneficiario", flexible: true, card: "title" },
          { header: "Monto", align: "right", width: "10rem", card: "aside" },
          { header: "Vence", width: "10rem", from: "xl" },
          { header: "Canal", width: "9.5rem", from: "3xl", card: "hidden" },
          { header: "Veredicto", width: "20.5rem" },
          { header: "Actualizada", width: "7.5rem", from: "2xl", card: "hidden" },
        ]}
        rows={rows.map((row) => ({
          key: row.invoiceId,
          href: `/facturas/${row.invoiceId}`,
          label: row.reference,
          cells: [
            <StatusBadge key="s" status={row.status} />,
            <span key="r" className="font-mono text-[12px]">
              {row.reference}
            </span>,
            <span key="p" className="font-medium">
              {row.decided?.payeeName ?? <span className="font-normal text-ink-3">sin leer</span>}
            </span>,
            <span key="a" className="font-mono">
              {row.decided?.amount ? formatMoney(row.decided.amount) : ""}
            </span>,
            <span key="d" className="text-ink-2">
              {row.decided ? dueRelative(row.decided.dueDate, today) : ""}
            </span>,
            <span key="c" className="text-ink-2">
              {CHANNEL_LABEL[row.channel]}
            </span>,
            row.decided ? (
              <VerdictChip
                key="v"
                verdict={row.decided.verdict}
                rule={row.decided.rule}
                policyVersion={row.decided.policyVersion}
              />
            ) : (
              <VerdictChip key="v" verdict="en_proceso" />
            ),
            <span key="u" className="text-ink-3">
              <time dateTime={row.updatedAt} title={instant(row.updatedAt, config.displayTimeZone)}>
                {relativeInstant(row.updatedAt, now, config.displayTimeZone)}
              </time>
            </span>,
          ],
        }))}
        empty={
          <EmptyState
            title={filtered ? "Ninguna factura con esos filtros." : "Todavía no hay facturas."}
            detail={filtered ? null : "Sube una factura o procesa las de ejemplo para empezar."}
            action={filtered ? { label: "Quitar filtros", href: "/facturas" } : null}
          />
        }
      />
    </div>
  );
}
