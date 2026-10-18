import { getConfig, type Config } from "@/src/config";
import { getDatabase, type Database } from "@/src/db/client";
import type { Ulid } from "@/src/domain";
import { authenticateApiKey } from "@/src/usecases";

import type { ApiError } from "./http";

/**
 * Contexto de la API de decisión (D32). No hay cookie de visitante: la empresa sale de la
 * llave de `Authorization: Bearer`. La API existe solo en la demo con el acceso de cliente
 * configurado, igual que el correo real y Telegram; si no, responde 404.
 */

export type ApiContext = {
  readonly config: Config;
  readonly db: Database;
  readonly organizationId: Ulid;
};

function apiError(status: number, error: ApiError["error"], headers?: HeadersInit): Response {
  return Response.json({ error } satisfies ApiError, { status, headers });
}

export function apiNotFound(message: string, action: string): Response {
  return apiError(404, { code: "not_found", message, action });
}

/** La empresa de la llave, o la respuesta de error que corresponde. */
export async function apiContext(request: Request): Promise<ApiContext | Response> {
  const config = getConfig();
  if (!config.demo.enabled || config.access === null) {
    return apiNotFound("La API de decisión está apagada", "Usa la pantalla de Yunque");
  }
  const db = await getDatabase(config.database);
  const header = request.headers.get("authorization") ?? "";
  const match = /^bearer\s+(\S+)$/i.exec(header);
  const organizationId = match?.[1] ? await authenticateApiKey(db, match[1], new Date()) : null;
  if (organizationId === null) {
    return apiError(
      401,
      {
        code: "unauthorized",
        message: "Falta la llave de la API, no es válida o venció",
        action:
          "Genera una llave en Facturas, «Probar con tu factura», «Conectar tu agente», y mándala en Authorization: Bearer. La llave vence con el acceso: si lo renovaste, genera otra.",
      },
      { "WWW-Authenticate": 'Bearer realm="yunque"' },
    );
  }
  return { config, db, organizationId };
}

/** Petición mal formada, con la ruta de cada campo que falla para que el agente la corrija. */
export function invalidRequest(
  message: string,
  issues: readonly { readonly path: string; readonly message: string }[] = [],
): Response {
  return Response.json(
    {
      error: {
        code: "invalid_request",
        message,
        action: "Corrige los campos indicados y vuelve a enviar la solicitud",
      },
      issues,
    },
    { status: 400 },
  );
}
