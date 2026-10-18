import Link from "next/link";
import { z } from "zod";

import { loadBatchCases } from "@/src/dataset/demo-seed";
import { loadMailbox } from "@/src/dataset/mailbox";
import { ChannelSchema, InvoiceStatusSchema, VerdictSchema, formatMoney } from "@/src/domain";
import { instant, relativeInstant } from "@/src/ui/format";
import { CHANNEL_SHORT_LABEL, RULE_SHORT_LABEL } from "@/src/ui/labels";
import {
  LIST_LIMIT,
  activeAccess,
  countByVerdict,
  loadInboundAddress,
  loadInvoiceList,
  loadTelegramStatus,
  narrowByVerdict,
  startOfBusinessDay,
  type InvoiceListRow,
  type ListVerdict,
} from "@/src/usecases";

import { ActionDialog } from "../../_components/action-dialog";
import { DataTable } from "../../_components/data-table";
import { CloseIcon, SearchIcon, UploadIcon } from "../../_components/icons";
import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";
import { VerdictPill } from "../../_components/verdict-pill";
import { appContext } from "../../_data/context";

import { AccessPanel, type ClientAccess } from "./access-panel";
import { DeliveryRunner } from "./delivery-runner";
import { UploadPanel } from "./upload-panel";

export const metadata = { title: "Facturas · Yunque" };

/**
 * Facturas (docs/interfaz.md §5.3): el archivo completo, con píldoras por veredicto (cada una
 * con cuántas hay), búsqueda por texto y los caminos de entrada de la pantalla: subir
 * archivos y, en la demo, procesar las facturas de ejemplo, revisar el correo de ejemplo y
 * probar con una factura propia por correo o Telegram (D23, D24). Los filtros viven en la URL,
 * así un enlace (como "Ver las 15" de Pendientes) abre la lista ya filtrada; estado y canal
 * se aceptan en la URL aunque la pantalla no los ofrezca.
 */

const FiltersSchema = z.object({
  veredicto: z
    .union([VerdictSchema, z.literal("en_proceso")])
    .optional()
    .catch(undefined),
  estado: InvoiceStatusSchema.optional().catch(undefined),
  canal: ChannelSchema.optional().catch(undefined),
  q: z.string().max(100).optional().catch(undefined),
  /** "hoy": solo las decididas hoy, como las cuenta Pendientes. */
  dia: z.literal("hoy").optional().catch(undefined),
});

type Filters = z.infer<typeof FiltersSchema>;

/** Píldoras por veredicto: el filtro más usado a un clic, con cuántas hay en cada una. */
const VERDICT_PILLS: readonly { verdict: ListVerdict | null; label: string; dot: string | null }[] =
  [
    { verdict: null, label: "Todas", dot: null },
    { verdict: "pagar", label: "Pagadas", dot: "bg-pay-solid" },
    { verdict: "escalar", label: "Escaladas", dot: "bg-escalate-solid" },
    { verdict: "frenar", label: "Frenadas", dot: "bg-hold-solid" },
    { verdict: "en_proceso", label: "En proceso", dot: "bg-ink-3" },
  ];

/** Enlace a la lista con un veredicto, conservando los demás filtros. */
function verdictHref(filters: Filters, verdict: ListVerdict | null): string {
  const params = new URLSearchParams();
  if (verdict) params.set("veredicto", verdict);
  if (filters.estado) params.set("estado", filters.estado);
  if (filters.canal) params.set("canal", filters.canal);
  if (filters.q) params.set("q", filters.q);
  if (filters.dia) params.set("dia", filters.dia);
  const query = params.toString();
  return query ? `/facturas?${query}` : "/facturas";
}

/** Por qué terminó así, en pocas palabras; las pagadas cumplen todo. */
function Reason({ row }: { readonly row: InvoiceListRow }) {
  const decided = row.decided;
  if (!decided) return <span className="text-ink-3">Leyendo el documento</span>;
  if (!decided.rule) return <span className="text-ink-3">Dentro de tus reglas</span>;
  const short = RULE_SHORT_LABEL[decided.rule.code];
  return (
    <span
      className="text-ink-2"
      title={`observado ${decided.rule.observed} · umbral ${decided.rule.threshold}`}
    >
      {short.charAt(0).toUpperCase() + short.slice(1)}
      <span className="sr-only">
        {" "}
        · observado {decided.rule.observed}, umbral {decided.rule.threshold}
      </span>
    </span>
  );
}

export default async function FacturasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = FiltersSchema.parse(await searchParams);
  const { config, db, organization } = await appContext();
  const now = new Date();
  const inbound = config.demo.enabled ? config.inboundEmail : null;
  const telegram = config.demo.enabled ? config.telegram : null;
  const accessEnabled = config.demo.enabled && config.access !== null;
  // Sin el veredicto: así cada píldora sabe cuántas tiene; el veredicto se aplica después.
  const [all, batch, mailbox, grant, emailAddress, telegramStatus] = await Promise.all([
    loadInvoiceList(
      db,
      organization.id,
      {
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
  const counts = countByVerdict(all);
  const rows = narrowByVerdict(all, filters.veredicto ?? null);
  const filtered = Boolean(
    filters.veredicto || filters.estado || filters.canal || filters.q || filters.dia,
  );
  // Lo que se busca o se filtra fuera de las píldoras: se puede quitar de una vez.
  const narrowed = Boolean(filters.estado || filters.canal || filters.q);

  return (
    <div className="flex flex-col gap-5 lg:h-full">
      <PageHeader
        title="Facturas"
        subtitle={
          <>
            {all.length === LIST_LIMIT ? `${String(LIST_LIMIT)}+` : all.length}{" "}
            {all.length === 1 ? "factura" : "facturas"} · todas las decisiones del agente y de tu
            equipo
          </>
        }
        actions={
          <>
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
                />
              </>
            ) : null}
            <ActionDialog label="Subir factura" primary icon={<UploadIcon />}>
              <UploadPanel maxBytes={config.demo.maxUploadBytes} />
            </ActionDialog>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3">
        <nav aria-label="Filtrar por veredicto">
          <ul className="flex flex-wrap gap-1.5">
            {VERDICT_PILLS.map(({ verdict, label, dot }) => {
              const active = (filters.veredicto ?? null) === verdict;
              return (
                <li key={label}>
                  <Link
                    href={verdictHref(filters, verdict)}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex h-[34px] items-center gap-2 rounded-full px-3.5 text-[13px] ${
                      active
                        ? "bg-surface-hover font-semibold text-ink"
                        : "text-ink-2 hover:bg-surface-hover hover:text-ink"
                    }`}
                  >
                    {dot ? (
                      <span aria-hidden="true" className={`size-[7px] rounded-full ${dot}`} />
                    ) : null}
                    {label}
                    <span className="num font-mono text-[12px] font-normal text-ink-3">
                      {counts[verdict ?? "todas"]}
                    </span>
                  </Link>
                </li>
              );
            })}
            {filters.dia ? (
              <li>
                <Link
                  href={verdictHref({ ...filters, dia: undefined }, filters.veredicto ?? null)}
                  aria-label="Quitar el filtro: decididas hoy"
                  className="inline-flex h-[34px] items-center gap-2 rounded-full border border-line-strong px-3.5 text-[13px] text-ink hover:bg-surface-hover"
                >
                  Decididas hoy
                  <CloseIcon />
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>

        <form role="search" className="ml-auto flex items-center gap-3">
          {filters.veredicto ? (
            <input type="hidden" name="veredicto" value={filters.veredicto} />
          ) : null}
          {filters.estado ? <input type="hidden" name="estado" value={filters.estado} /> : null}
          {filters.canal ? <input type="hidden" name="canal" value={filters.canal} /> : null}
          {filters.dia ? <input type="hidden" name="dia" value={filters.dia} /> : null}
          {narrowed ? (
            <Link
              href={verdictHref({ dia: filters.dia }, filters.veredicto ?? null)}
              className="text-[13px] whitespace-nowrap text-ink-2 underline underline-offset-4"
            >
              Quitar búsqueda
            </Link>
          ) : null}
          <label className="flex h-9 w-[17.5rem] items-center gap-2 rounded-[8px] border border-line bg-surface-hover px-3 text-ink-3 focus-within:border-control">
            <SearchIcon className="size-3.5 shrink-0" />
            <span className="sr-only">Buscar beneficiario o referencia</span>
            <input
              name="q"
              type="search"
              data-shortcut="buscar"
              defaultValue={filters.q ?? ""}
              placeholder="Beneficiario o referencia"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
            <kbd
              aria-hidden="true"
              className="rounded-[4px] border border-line-strong px-1.5 font-mono text-[11px] text-ink-3"
            >
              /
            </kbd>
          </label>
        </form>
      </div>

      <DataTable
        fill
        spacious
        caption="Facturas, las más recientes primero"
        columns={[
          { header: "Beneficiario", width: "15rem", card: "title" },
          { header: "Monto", align: "right", width: "10rem", card: "aside" },
          { header: "Veredicto", width: "8.5rem" },
          { header: "Motivo", flexible: true },
          { header: "Canal", width: "6.5rem", from: "xl", card: "hidden" },
          { header: "Actualizada", align: "right", width: "7.5rem", from: "lg", card: "hidden" },
        ]}
        rows={rows.map((row) => ({
          key: row.invoiceId,
          href: `/facturas/${row.invoiceId}`,
          label: row.reference,
          cells: [
            <span key="p" className="block min-w-0">
              <span className="block truncate font-medium text-ink">
                {row.decided?.payeeName ?? <span className="font-normal text-ink-3">sin leer</span>}
              </span>
              <span className="block font-mono text-[11px] text-ink-3">{row.reference}</span>
            </span>,
            <span key="a" className="font-mono font-medium">
              {row.decided?.amount ? (
                formatMoney(row.decided.amount)
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </span>,
            <VerdictPill key="v" verdict={row.decided?.verdict ?? "en_proceso"} />,
            <Reason key="m" row={row} />,
            <span key="c" className="text-ink-3">
              {CHANNEL_SHORT_LABEL[row.channel]}
            </span>,
            <span key="u" className="font-sans text-ink-3">
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
