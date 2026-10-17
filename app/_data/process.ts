import type { Config } from "@/src/config";
import type { Database } from "@/src/db/client";
import { createUlidGenerator } from "@/src/domain";
import { createOpenRouterClient } from "@/src/extraction";
import { createModelReader, currentBusinessDate, type ProcessInvoiceDeps } from "@/src/usecases";

import { appContext, type AppContext } from "./context";
import { fileStorage } from "./storage";

/**
 * Dependencias para procesar facturas desde la app: base, almacenamiento, Lector con la
 * caché en base y límites de la configuración. Sin clave del modelo el Lector queda
 * apagado y las facturas escalan como ilegibles (nunca se pagan).
 *
 * En la demo pública la caché del Lector es compartida (D14): cada copia de la empresa
 * reutiliza las lecturas del dataset sin volver a pagar el modelo.
 */

/** Ámbito compartido de la caché en la demo. */
const DEMO_CACHE_SCOPE = "demo";

const newId = createUlidGenerator();

export async function processingContext(): Promise<
  AppContext & { readonly deps: ProcessInvoiceDeps }
> {
  const context = await appContext();
  return { ...context, deps: processingDeps(context.config, context.db) };
}

/**
 * Las mismas dependencias sin la sesión del visitante: el webhook de correo no trae cookie,
 * su empresa sale de la dirección a la que escribieron.
 */
export function processingDeps(config: Config, db: Database): ProcessInvoiceDeps {
  const storage = fileStorage();
  const now = () => new Date();
  const reader = config.model
    ? createModelReader({
        db,
        storage,
        client: createOpenRouterClient(config.model.apiKey),
        primaryModel: config.model.primary,
        fallbackModel: config.model.fallback,
        maxOutputTokens: config.model.maxOutputTokens,
        cacheScope: (organizationId) => (config.demo.enabled ? DEMO_CACHE_SCOPE : organizationId),
        newId,
        now,
      })
    : null;
  return {
    db,
    storage,
    reader,
    limits: {
      maxUploadBytes: config.demo.maxUploadBytes,
      maxPages: config.demo.maxPagesRendered,
    },
    newId,
    now,
    timeZone: config.displayTimeZone,
    businessDate: currentBusinessDate(
      { demo: config.demo.enabled, timeZone: config.displayTimeZone },
      now(),
    ),
  };
}
