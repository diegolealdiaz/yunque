import { DbError } from "@/src/db/errors";
import { renderPaymentOrder } from "@/src/documents/payment-order";
import { loadPaymentOrder } from "@/src/usecases";

import { appContext } from "../../../../_data/context";

/**
 * Descarga de la orden de pago en PDF (paso 27). Se genera en el servidor con lo que la
 * decisión registró, nunca con el texto extraído, y solo para la empresa de quien pide; si
 * la factura no es suya o no tiene orden, responde igual que una inexistente.
 */

/** Generar el PDF es rápido, pero es trabajo de servidor: plazo explícito. */
export const maxDuration = 30;

function notFound(): Response {
  return new Response("No hay orden de pago para esta factura", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { db, organization } = await appContext();
  const sheet = await loadPaymentOrder(db, organization.id, id).catch((error: unknown) => {
    if (error instanceof DbError && error.code === "not_found") return null;
    throw error;
  });
  if (!sheet) return notFound();
  const bytes = await renderPaymentOrder(sheet);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="orden-${sheet.order.reference}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
