import type { Database } from "@/src/db/client";
import { findInvoiceByReceiptKey, getLatestDecision } from "@/src/db/repositories";
import type { InvoiceStatus, ReceiptKey, Ulid, Verdict } from "@/src/domain";

/**
 * Qué casos de la galería ya procesó la empresa (docs/interfaz.md §5.8): por su llave de
 * recepción, la misma del lote, así una factura procesada desde la galería o con todo el
 * lote es la misma y la tarjeta lleva a ella en vez de procesarla otra vez.
 */

export type GalleryInvoice = {
  readonly invoiceId: Ulid;
  readonly status: InvoiceStatus;
  /** Veredicto vigente; null mientras se lee. */
  readonly verdict: Verdict | null;
};

export async function loadGalleryInvoices(
  db: Database,
  organizationId: Ulid,
  receiptKeys: readonly ReceiptKey[],
): Promise<ReadonlyMap<ReceiptKey, GalleryInvoice>> {
  const found = await Promise.all(
    receiptKeys.map(async (key) => {
      const invoice = await findInvoiceByReceiptKey(db, organizationId, key);
      if (!invoice) return null;
      const decision = await getLatestDecision(db, organizationId, invoice.id);
      return [
        key,
        { invoiceId: invoice.id, status: invoice.status, verdict: decision?.verdict ?? null },
      ] as const;
    }),
  );
  return new Map(found.filter((entry) => entry !== null));
}
