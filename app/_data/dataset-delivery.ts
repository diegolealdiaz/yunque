import { readFile } from "node:fs/promises";

import type { Channel, ReceiptKey } from "@/src/domain";
import { assertWithinDailyLimits, processInvoice, startOfBusinessDay } from "@/src/usecases";

import { deliverNotificationsAfterResponse } from "./notify";
import { processingContext } from "./process";

/**
 * Entrega de un archivo del dataset por un canal simulado: el lote del periodo o la bandeja
 * de correo. El archivo lo elige el servidor de una lista cerrada; el navegador solo nombra
 * el caso. Respeta los topes del día y entrega los avisos después de responder.
 */
export async function deliverDatasetFile(input: {
  readonly id: string;
  readonly file: string;
  readonly channel: Channel;
  readonly receiptKey: ReceiptKey;
}): Promise<Response> {
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
  const bytes = new Uint8Array(await readFile(input.file));
  const result = await processInvoice(deps, {
    organizationId: organization.id,
    channel: input.channel,
    receiptKey: input.receiptKey,
    bytes,
    originalName: input.file.split("/").pop() ?? input.id,
  });
  deliverNotificationsAfterResponse(organization.id);
  return Response.json({
    kind: result.kind,
    caso: input.id,
    invoiceId: result.invoice.id,
    reference: result.invoice.reference,
    verdict: result.decision?.verdict ?? null,
  });
}

/** Respuesta para un caso que no está en la lista cerrada. */
export function unknownCase(message: string): Response {
  return Response.json(
    { error: { code: "unknown_case", message, action: "Recarga la página" } },
    { status: 404 },
  );
}
