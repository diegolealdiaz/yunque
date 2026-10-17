import type { Database } from "@/src/db/client";
import { countAllInvoicesSince, countInvoicesSince, listInvoices } from "@/src/db/repositories";
import {
  normalizeText,
  type Channel,
  type InvoiceStatus,
  type Ulid,
  type Verdict,
} from "@/src/domain";

import { UseCaseError } from "./errors";
import { describeInvoices, type InboxRow } from "./inbox";

/**
 * Archivo de facturas (docs/interfaz.md §5.3) y topes diarios de la demo pública
 * (docs/practicas.md 57).
 */

export type InvoiceListFilter = {
  readonly verdict?: Verdict;
  readonly status?: InvoiceStatus;
  readonly channel?: Channel;
  /** Texto libre: beneficiario o referencia. */
  readonly query?: string;
};

export type InvoiceListRow = {
  readonly invoiceId: Ulid;
  readonly reference: string;
  readonly status: InvoiceStatus;
  readonly channel: Channel;
  readonly receivedAt: string;
  readonly updatedAt: string;
  /** La fila de la decisión vigente, o null si todavía no hay decisión. */
  readonly decided: InboxRow | null;
};

/** Cuántas facturas lee la lista. Por encima, la pantalla pide filtrar. */
export const LIST_LIMIT = 500;

/**
 * Facturas de la organización, las más recientes primero, con los filtros de la pantalla.
 * El estado se filtra en la base; veredicto, canal y texto sobre las filas ya armadas.
 */
export async function loadInvoiceList(
  db: Database,
  organizationId: Ulid,
  filter: InvoiceListFilter,
  now: Date,
): Promise<InvoiceListRow[]> {
  const invoices = await listInvoices(db, organizationId, {
    ...(filter.status ? { status: filter.status } : {}),
    limit: LIST_LIMIT,
  });
  const described = await describeInvoices(db, organizationId, invoices, now);
  const query = filter.query ? normalizeText(filter.query) : "";
  return described
    .filter(({ invoice, row }) => {
      if (filter.channel && invoice.channel !== filter.channel) return false;
      if (filter.verdict && row?.verdict !== filter.verdict) return false;
      if (query) {
        const haystack = normalizeText(`${invoice.reference} ${row?.payeeName ?? ""}`);
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .map(({ invoice, row }) => ({
      invoiceId: invoice.id,
      reference: invoice.reference,
      status: invoice.status,
      channel: invoice.channel,
      receivedAt: invoice.received_at,
      updatedAt: invoice.updated_at,
      decided: row,
    }));
}

export type DailyLimits = {
  readonly perOrganization: number;
  readonly global: number;
};

/**
 * Antes de aceptar una entrega nueva: la empresa y toda la demo están dentro de su tope del
 * día. Superado, la entrega se rechaza con un mensaje claro; lo ya procesado sigue disponible.
 */
export async function assertWithinDailyLimits(
  db: Database,
  organizationId: Ulid,
  limits: DailyLimits,
  since: string,
): Promise<void> {
  const [mine, all] = await Promise.all([
    countInvoicesSince(db, organizationId, since),
    countAllInvoicesSince(db, since),
  ]);
  if (mine >= limits.perOrganization) {
    throw new UseCaseError("limit_reached", "Llegaste al máximo de facturas por hoy", {
      action: "Vuelve mañana; el dataset ya procesado sigue disponible",
      severity: "warning",
    });
  }
  if (all >= limits.global) {
    throw new UseCaseError("limit_reached", "La demo llegó al máximo de facturas por hoy", {
      action: "Vuelve mañana; el dataset ya procesado sigue disponible",
      severity: "warning",
    });
  }
}
