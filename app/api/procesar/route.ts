import { ReceiptKeySchema } from "@/src/domain";
import { assertWithinDailyLimits, processInvoice, startOfBusinessDay } from "@/src/usecases";

import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../_data/http";
import { processingContext } from "../../_data/process";

/**
 * Procesa una factura subida desde la pantalla (docs/arquitectura.md §5): un archivo por
 * petición, con su llave de entrega, por el mismo caso de uso que todos los canales.
 *
 * La llave la genera el navegador al elegir el archivo, así un doble clic o un reintento de
 * red no crean dos facturas. La empresa sale de la cookie verificada, nunca del formulario.
 */

/**
 * Segundos que la plataforma deja correr la ruta: más que el plazo global de lectura del
 * modelo (`READ_DEADLINE_MS`, 60 s), porque normalizar y registrar también toman su tiempo.
 * La prueba de rutas comprueba que el plazo cabe.
 */
export const maxDuration = 90;

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  try {
    const { config, db, organization, deps } = await processingContext();
    const form = await request.formData();
    const file = form.get("archivo");
    const receiptKey = ReceiptKeySchema.safeParse(form.get("llave"));
    if (!(file instanceof File) || !receiptKey.success || !receiptKey.data.startsWith("upload:")) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            message: "Falta el archivo o la llave de la entrega",
            action: "Vuelve a elegir el archivo",
          },
        },
        { status: 400 },
      );
    }
    // Antes de leerlo entero: un archivo demasiado grande se rechaza por su tamaño declarado.
    if (file.size > config.demo.maxUploadBytes) {
      return Response.json(
        {
          error: {
            code: "too_large",
            message: "El archivo supera el tamaño máximo",
            action: "Sube un archivo más liviano",
          },
        },
        { status: 413 },
      );
    }
    await assertWithinDailyLimits(
      db,
      organization.id,
      {
        perOrganization: config.demo.maxInvoicesPerVisitorPerDay,
        global: config.demo.maxInvoicesPerDay,
      },
      startOfBusinessDay(new Date(), config.displayTimeZone).toISOString(),
    );
    const result = await processInvoice(deps, {
      organizationId: organization.id,
      channel: "upload",
      receiptKey: receiptKey.data,
      bytes: new Uint8Array(await file.arrayBuffer()),
      originalName: file.name,
    });
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
