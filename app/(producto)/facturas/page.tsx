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
import { dueRelative, instant } from "@/src/ui/format";
import { CHANNEL_LABEL, STATUS_LABEL, VERDICT_LABEL } from "@/src/ui/labels";
import { LIST_LIMIT, currentBusinessDate, loadInvoiceList } from "@/src/usecases";

import { DataTable } from "../../_components/data-table";
import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/states";
import { VerdictChip } from "../../_components/verdict-chip";
import { appContext } from "../../_data/context";

import { DeliveryRunner } from "./delivery-runner";
import { UploadPanel } from "./upload-panel";

export const metadata = { title: "Facturas · Yunque" };

/**
 * Facturas (docs/interfaz.md §5.3): el archivo completo, con filtros por veredicto, estado,
 * canal y texto, y los caminos de entrada de la pantalla: subir archivos, procesar el periodo
 * y, en la demo, leer la bandeja de correo simulada. Los filtros viven en la URL, así un
 * enlace (como "Ver las 15" de Pendientes) abre la lista ya filtrada.
 */

const FiltersSchema = z.object({
  veredicto: VerdictSchema.optional().catch(undefined),
  estado: InvoiceStatusSchema.optional().catch(undefined),
  canal: ChannelSchema.optional().catch(undefined),
  q: z.string().max(100).optional().catch(undefined),
});

const VERDICTS: readonly Verdict[] = ["pagar", "escalar", "frenar"];
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
  const [rows, batch, mailbox] = await Promise.all([
    loadInvoiceList(
      db,
      organization.id,
      {
        ...(filters.veredicto ? { verdict: filters.veredicto } : {}),
        ...(filters.estado ? { status: filters.estado } : {}),
        ...(filters.canal ? { channel: filters.canal } : {}),
        ...(filters.q ? { query: filters.q } : {}),
      },
      now,
    ),
    config.demo.enabled ? loadBatchCases() : Promise.resolve([]),
    config.demo.enabled ? loadMailbox() : Promise.resolve([]),
  ]);
  const filtered = Boolean(filters.veredicto || filters.estado || filters.canal || filters.q);

  return (
    <div className="max-w-7xl space-y-6">
      <PageHeader
        title="Facturas"
        meta={
          <span>
            {rows.length === LIST_LIMIT ? `${String(LIST_LIMIT)}+` : rows.length} facturas
          </span>
        }
        actions={
          config.demo.enabled ? (
            <>
              <DeliveryRunner
                endpoint="/api/bandeja"
                field="mensaje"
                ids={mailbox.map((m) => m.id)}
                label="Leer bandeja"
                noun="correos"
              />
              <DeliveryRunner
                endpoint="/api/lote"
                field="caso"
                ids={batch.map((c) => c.id)}
                label="Procesar periodo"
                noun="facturas"
                primary
              />
            </>
          ) : null
        }
      />

      <details className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <summary className="cursor-pointer text-[13px] font-medium text-ink">Subir factura</summary>
        <div className="mt-3">
          <UploadPanel maxBytes={config.demo.maxUploadBytes} />
        </div>
      </details>

      <form className="flex flex-wrap items-end gap-3" role="search">
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
          name="veredicto"
          label="Veredicto"
          value={filters.veredicto}
          options={VERDICTS}
          labelOf={(v) => VERDICT_LABEL[v]}
        />
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
        caption="Facturas, las más recientes primero"
        columns={[
          { header: "Estado", width: "8.5rem" },
          { header: "Referencia", width: "9rem" },
          { header: "Beneficiario" },
          { header: "Monto", align: "right", width: "11rem" },
          { header: "Vence", width: "8.5rem" },
          { header: "Canal", width: "8.5rem" },
          { header: "Veredicto", width: "16rem" },
          { header: "Actualizada", width: "7rem" },
        ]}
        rows={rows.map((row) => ({
          key: row.invoiceId,
          href: `/facturas/${row.invoiceId}`,
          cells: [
            <span key="s" className="text-ink-2">
              {STATUS_LABEL[row.status]}
            </span>,
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
              {instant(row.updatedAt)}
            </span>,
          ],
        }))}
        empty={
          <EmptyState
            title={filtered ? "Ninguna factura con esos filtros." : "Todavía no hay facturas."}
            detail={filtered ? null : "Sube una factura o procesa el periodo para empezar."}
            action={filtered ? { label: "Quitar filtros", href: "/facturas" } : null}
          />
        }
      />
    </div>
  );
}
