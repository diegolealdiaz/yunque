import type { Database } from "@/src/db/client";
import {
  countAllInvoicesSince,
  countInvoicesSince,
  findInvoiceByReceiptKey,
  listInvoices,
} from "@/src/db/repositories";
import {
  normalizeText,
  type Channel,
  type InvoiceStatus,
  type ReceiptKey,
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
  /** Solo las decididas desde este instante (ISO), como "pagadas hoy" en Pendientes. */
  readonly decidedSince?: string;
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
      if (filter.decidedSince && (!row || row.decidedAt < filter.decidedSince)) return false;
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
 * Una entrega que ya se recibió (misma llave) no cuenta: devuelve la factura que ya existe.
 * El conteo y el registro no son atómicos: peticiones en paralelo pueden pasar el tope por
 * unas pocas facturas, lo que basta para una demo pública.
 */
export async function assertWithinDailyLimits(
  db: Database,
  organizationId: Ulid,
  limits: DailyLimits,
  since: string,
  receiptKey: ReceiptKey,
  options: {
    /**
     * Si cuenta contra el tope global de toda la demo. El tope global acota el costo del modelo:
     * las facturas de ejemplo del dataset (lote y bandeja) se leen de una caché persistente y su
     * contenido está acotado a unos pocos documentos, así que no deben poder agotar ese tope ni
     * dejar fuera a los canales que sí cuestan (subida, API, correo y Telegram reales). El tope
     * por visitante sí aplica siempre, para que nadie llene su propia empresa.
     */
    readonly countTowardGlobal?: boolean;
  } = {},
): Promise<void> {
  if (await findInvoiceByReceiptKey(db, organizationId, receiptKey)) return;
  const countTowardGlobal = options.countTowardGlobal ?? true;
  const [mine, all] = await Promise.all([
    countInvoicesSince(db, organizationId, since),
    countTowardGlobal ? countAllInvoicesSince(db, since) : Promise.resolve(0),
  ]);
  if (mine >= limits.perOrganization) {
    throw new UseCaseError("limit_reached", "Llegaste al máximo de facturas por hoy", {
      action: "Vuelve mañana; el dataset ya procesado sigue disponible",
      severity: "warning",
    });
  }
  if (countTowardGlobal && all >= limits.global) {
    throw new UseCaseError("limit_reached", "La demo llegó al máximo de facturas por hoy", {
      action: "Vuelve mañana; el dataset ya procesado sigue disponible",
      severity: "warning",
    });
  }
}

/** Filtro de las píldoras de Facturas: un veredicto, o las que siguen sin decisión. */
export type ListVerdict = Verdict | "en_proceso";

/** Cuántas facturas hay en cada píldora de Facturas. */
export type ListCounts = Readonly<Record<ListVerdict | "todas", number>>;

export function countByVerdict(rows: readonly InvoiceListRow[]): ListCounts {
  const counts = { todas: rows.length, pagar: 0, escalar: 0, frenar: 0, en_proceso: 0 };
  for (const row of rows) counts[row.decided?.verdict ?? "en_proceso"] += 1;
  return counts;
}

/** Las filas de una píldora; sin píldora, todas. */
export function narrowByVerdict(
  rows: readonly InvoiceListRow[],
  verdict: ListVerdict | null,
): readonly InvoiceListRow[] {
  if (verdict === null) return rows;
  return rows.filter((row) => (row.decided?.verdict ?? "en_proceso") === verdict);
}
