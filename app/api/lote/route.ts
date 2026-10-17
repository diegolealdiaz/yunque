import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { GENERATED_DIR, channelOfFormat, loadBatchCases } from "@/src/dataset/demo-seed";
import { receiptKeyFor } from "@/src/domain";
import { assertWithinDailyLimits, processInvoice, startOfBusinessDay } from "@/src/usecases";

import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../_data/http";
import { processingContext } from "../../_data/process";

/**
 * "Procesar periodo" (docs/arquitectura.md §5): el navegador pide las facturas del dataset
 * una por petición y muestra el progreso, así ninguna petición supera el tiempo de una
 * función sin estado. El cliente nombra un caso de la lista cerrada de `verdad.json`; el
 * archivo lo elige el servidor, nunca una ruta que venga de afuera.
 */

/** Como la subida: más que el plazo global de lectura del modelo. */
export const maxDuration = 90;

const RequestSchema = z.strictObject({ caso: z.string().regex(/^[a-z0-9_]{1,60}$/) });

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  try {
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    const cases = await loadBatchCases();
    const batchCase = parsed.success ? cases.find((c) => c.id === parsed.data.caso) : undefined;
    if (!batchCase) {
      return Response.json(
        {
          error: {
            code: "unknown_case",
            message: "Ese caso no está en el lote del periodo",
            action: "Recarga la página",
          },
        },
        { status: 404 },
      );
    }
    const { config, db, organization, deps } = await processingContext();
    await assertWithinDailyLimits(
      db,
      organization.id,
      {
        perOrganization: config.demo.maxInvoicesPerVisitorPerDay,
        global: config.demo.maxInvoicesPerDay,
      },
      startOfBusinessDay(new Date(), config.displayTimeZone).toISOString(),
    );
    const bytes = new Uint8Array(await readFile(path.join(GENERATED_DIR, batchCase.file)));
    const result = await processInvoice(deps, {
      organizationId: organization.id,
      channel: channelOfFormat(batchCase.format),
      // La misma llave por caso: volver a procesar el periodo no duplica facturas.
      receiptKey: receiptKeyFor("batch", batchCase.id),
      bytes,
      originalName: batchCase.file,
    });
    return Response.json({
      kind: result.kind,
      caso: batchCase.id,
      invoiceId: result.invoice.id,
      reference: result.invoice.reference,
      verdict: result.decision?.verdict ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
