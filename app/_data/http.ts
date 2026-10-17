import {
  ApprovalError,
  CorrectionError,
  UseCaseError,
  type UseCaseErrorCode,
} from "@/src/usecases";

/**
 * Respuestas de las rutas de la API: JSON con código, mensaje y acción sugerida, y el estado
 * HTTP que corresponde. Un error desconocido no expone su detalle.
 */

const STATUS: Readonly<Record<UseCaseErrorCode, number>> = {
  rejected_document: 400,
  organization_not_found: 404,
  policy_missing: 409,
  storage_unavailable: 503,
  record_failed: 500,
  limit_reached: 429,
  policy_changed: 409,
};

export type ApiError = {
  readonly error: { readonly code: string; readonly message: string; readonly action: string };
};

export function errorResponse(error: unknown): Response {
  if (error instanceof UseCaseError) {
    return Response.json(
      {
        error: { code: error.code, message: error.message, action: error.action },
      } satisfies ApiError,
      { status: STATUS[error.code] },
    );
  }
  if (error instanceof ApprovalError || error instanceof CorrectionError) {
    return Response.json(
      {
        error: { code: error.code, message: error.message, action: error.action },
      } satisfies ApiError,
      { status: 409 },
    );
  }
  console.error(error);
  return Response.json(
    {
      error: {
        code: "unexpected",
        message: "No se pudo procesar la petición",
        action: "Reintenta en unos segundos; si sigue fallando, revisa la salud del sistema",
      },
    } satisfies ApiError,
    { status: 500 },
  );
}

/**
 * Las rutas que escriben solo aceptan peticiones del propio sitio: el navegador siempre
 * manda `Origin` en un POST, y debe ser el mismo que el de la app. Junto con la cookie
 * `SameSite=Lax`, cierra la falsificación de peticiones desde otro sitio.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function forbiddenOrigin(): Response {
  return Response.json(
    {
      error: {
        code: "forbidden_origin",
        message: "La petición no viene de esta aplicación",
        action: "Usa la pantalla de Yunque",
      },
    } satisfies ApiError,
    { status: 403 },
  );
}
