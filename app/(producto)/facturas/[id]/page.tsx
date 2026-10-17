import Link from "next/link";
import { notFound } from "next/navigation";

import { DbError } from "@/src/db/errors";
import { getInvoice } from "@/src/db/repositories";

import { PageHeader } from "../../../_components/page-header";
import { EmptyState } from "../../../_components/states";
import { appContext } from "../../../_data/context";

export const metadata = { title: "Factura · Yunque" };

/**
 * Detalle de una factura: se construye en el paso 21. Ya verifica que la factura sea de la
 * empresa de quien pide: un id de otra empresa responde "no existe".
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, organization } = await appContext();
  const invoice = await getInvoice(db, organization.id, id).catch((error: unknown) => {
    if (error instanceof DbError && error.code === "not_found") notFound();
    throw error;
  });
  return (
    <>
      <Link
        href="/pendientes"
        data-shortcut="volver"
        className="text-[13px] text-ink-2 hover:text-ink"
      >
        ← Pendientes
      </Link>
      <PageHeader title={invoice.reference} />
      <EmptyState
        title="El detalle de la decisión se construye en el paso 21"
        detail="Ahí estarán el documento con las citas, los campos leídos, la traza de reglas y la aprobación."
      />
    </>
  );
}
