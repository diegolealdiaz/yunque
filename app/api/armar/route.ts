import { z } from "zod";

import { renderPdf } from "@/src/dataset/render";
import { invoiceTemplate } from "@/src/dataset/templates";
import { ReceiptKeySchema } from "@/src/domain";
import {
  InvoiceChoiceSchema,
  composeInvoice,
  currentBusinessDate,
  processInvoice,
} from "@/src/usecases";

import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../_data/http";
import { assertDemoLimits } from "../../_data/limits";
import { deliverNotificationsAfterResponse } from "../../_data/notify";
import { processingContext } from "../../_data/process";

/**
 * Arma tu propia factura (docs/roadmap.md, nivel 4): pinta la factura que eligió el cliente
 * con la plantilla del dataset y la procesa como una subida, con la misma llave de entrega,
 * los mismos topes y el mismo Lector. Va en su propia ruta para que el generador de PDF no
 * se cargue en las demás. Solo en la demo; la empresa sale de la cookie.
 */

/** Pintar el PDF y leerlo con el modelo: el mismo plazo que una subida. */
export const maxDuration = 90;

const RequestSchema = z.strictObject({
  llave: ReceiptKeySchema.refine((k) => k.startsWith("upload:"), {
    error: "La llave de la entrega no es válida",
  }),
  factura: InvoiceChoiceSchema,
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  try {
    const { config, db, organization, deps } = await processingContext();
    if (!config.demo.enabled) {
      return Response.json(
        {
          error: {
            code: "not_found",
            message: "Armar una factura solo existe en la demo",
            action: "Sube una factura desde Facturas",
          },
        },
        { status: 404 },
      );
    }
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            message: parsed.error.issues[0]?.message ?? "La factura no tiene los datos esperados",
            action: "Revisa los campos y vuelve a intentar",
          },
        },
        { status: 400 },
      );
    }
    const { llave, factura } = parsed.data;
    await assertDemoLimits(config, db, organization.id, llave);
    const today =
      deps.businessDate ??
      currentBusinessDate({ demo: true, timeZone: config.displayTimeZone }, new Date());
    const { templateId, document } = await composeInvoice(db, {
      organizationId: organization.id,
      choice: factura,
      today,
      random: Math.random,
    });
    const { bytes } = await renderPdf(invoiceTemplate(templateId), document);
    const result = await processInvoice(deps, {
      organizationId: organization.id,
      channel: "upload",
      receiptKey: llave,
      bytes,
      originalName: `factura-armada-${document.invoice_number}.pdf`,
    });
    deliverNotificationsAfterResponse(organization.id);
    return Response.json({
      kind: result.kind,
      invoiceId: result.invoice.id,
      reference: result.invoice.reference,
      verdict: result.decision?.verdict ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
