import { ReferenceSchema } from "@/src/domain";
import { apiDecisionBody } from "@/src/ui/api-decision";
import { apiDecisionByReference, decidingFinding } from "@/src/usecases";

import { apiContext, apiNotFound } from "../../../_data/api";
import { errorResponse } from "../../../_data/http";

/**
 * Estado vigente de una solicitud de la API de decisión (D32), por su referencia. El agente
 * que recibió `escalar` consulta aquí hasta que una persona la aprueba o la rechaza.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<Response> {
  const notFound = () =>
    apiNotFound(
      "No hay una solicitud con esa referencia",
      "Usa la referencia que devolvió POST /api/decide",
    );
  try {
    const context = await apiContext(request);
    if (context instanceof Response) return context;
    const { config, db, organizationId } = context;
    const reference = ReferenceSchema.safeParse((await params).reference);
    if (!reference.success) return notFound();
    const found = await apiDecisionByReference(db, organizationId, reference.data);
    if (found === null) return notFound();
    return Response.json(
      apiDecisionBody({
        ...found,
        decidingRule: found.decision ? (decidingFinding(found.decision)?.code ?? null) : null,
        replayed: false,
        appUrl: config.publicAppUrl,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
