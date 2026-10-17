import path from "node:path";

import { z } from "zod";

import {
  GENERATED_DIR,
  channelOfFormat,
  datasetReceiptKey,
  loadBatchCases,
} from "@/src/dataset/demo-seed";

import {
  deliverDatasetFile,
  demoChannelsDisabled,
  unknownCase,
} from "../../_data/dataset-delivery";
import { errorResponse, forbiddenOrigin, isSameOrigin } from "../../_data/http";

/**
 * "Procesar facturas de ejemplo" (docs/arquitectura.md §5): el navegador pide las facturas del dataset
 * una por petición y muestra el progreso, así ninguna petición supera el tiempo de una
 * función sin estado. El cliente nombra un caso de la lista cerrada de `verdad.json`; el
 * archivo lo elige el servidor, nunca una ruta que venga de afuera.
 */

/** Como la subida: más que el plazo global de lectura del modelo. */
export const maxDuration = 90;

const RequestSchema = z.strictObject({ caso: z.string().regex(/^[a-z0-9_]{1,60}$/) });

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const disabled = demoChannelsDisabled();
  if (disabled) return disabled;
  try {
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    const cases = await loadBatchCases();
    const batchCase = parsed.success ? cases.find((c) => c.id === parsed.data.caso) : undefined;
    if (!batchCase) return unknownCase("Ese caso no está en el lote del periodo");
    return await deliverDatasetFile({
      id: batchCase.id,
      file: path.join(GENERATED_DIR, batchCase.file),
      channel: channelOfFormat(batchCase.format),
      // La misma llave por caso: volver a procesar el periodo no duplica facturas, y un
      // correo ya leído de la bandeja no se recibe de nuevo.
      receiptKey: datasetReceiptKey(batchCase),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
