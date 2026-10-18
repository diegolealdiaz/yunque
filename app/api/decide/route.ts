import { z } from "zod";

import { renderPaymentRequest } from "@/src/documents/payment-request";
import { PaymentRequestSchema, receiptKeyFor, type PaymentRequest } from "@/src/domain";
import { apiDecisionBody } from "@/src/ui/api-decision";
import {
  decideApiDocument,
  decidePaymentRequest,
  decidingFinding,
  type ProcessInvoiceResult,
} from "@/src/usecases";

import { apiContext, invalidRequest, type ApiContext } from "../../_data/api";
import { errorResponse, readBodyCapped } from "../../_data/http";
import { assertDemoLimits } from "../../_data/limits";
import { deliverNotificationsAfterResponse } from "../../_data/notify";
import { processingDeps } from "../../_data/process";

/**
 * API de decisión para otros agentes (D32): «¿puedo pagar esto?». Acepta la solicitud de dos
 * formas y las dos terminan en `processInvoice`:
 *
 * - JSON con los campos de la factura: Yunque arma el documento y lo lee sin modelo.
 * - `multipart/form-data` con `file` (PDF o imagen) e `idempotency_key`: lo lee el Lector.
 *
 * Responde 201 con la decisión nueva, o 200 con la que ya existía para esa llave. La empresa
 * sale de la llave de la API, nunca del cuerpo.
 */

/** Igual que la subida: más que el plazo de lectura del modelo, con margen para registrar. */
export const maxDuration = 90;

/** Una solicitud con campos es texto corto: más que esto no es una solicitud. */
const MAX_JSON_BYTES = 20_000;
/** El formulario trae el archivo y poco más: cabeceras y la llave. */
const FORM_OVERHEAD_BYTES = 64_000;

const IdempotencyKeySchema = PaymentRequestSchema.shape.idempotency_key;

/** Lo que pidió el agente, ya validado. */
type ApiRequest =
  | { readonly kind: "fields"; readonly request: PaymentRequest }
  | { readonly kind: "document"; readonly idempotencyKey: string; readonly file: File };

function issuesOf(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join(".") || "(cuerpo)", message: i.message }));
}

function tooLarge(): Response {
  return Response.json(
    {
      error: {
        code: "too_large",
        message: "El archivo supera el tamaño máximo",
        action: "Manda un archivo más liviano",
      },
    },
    { status: 413 },
  );
}

async function readDocument(request: Request, maxBytes: number): Promise<ApiRequest | Response> {
  // El formulario se lee entero en memoria: el tamaño declarado se revisa antes de leerlo.
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes + FORM_OVERHEAD_BYTES) {
    return tooLarge();
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return invalidRequest("El formulario no se pudo leer");
  }
  const file = form.get("file");
  const key = IdempotencyKeySchema.safeParse(form.get("idempotency_key"));
  if (!(file instanceof File)) return invalidRequest("Falta el archivo en el campo «file»");
  if (!key.success) {
    return invalidRequest("La llave de idempotencia no es válida", issuesOf(key.error));
  }
  if (file.size > maxBytes) return tooLarge();
  return { kind: "document", idempotencyKey: key.data, file };
}

async function readFields(request: Request): Promise<ApiRequest | Response> {
  const raw = await readBodyCapped(request, MAX_JSON_BYTES);
  if (raw === null) return invalidRequest("La solicitud es demasiado grande");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalidRequest("El cuerpo no es un JSON válido");
  }
  const parsed = PaymentRequestSchema.safeParse(json);
  if (!parsed.success) {
    return invalidRequest("La solicitud no tiene los campos esperados", issuesOf(parsed.error));
  }
  return { kind: "fields", request: parsed.data };
}

function keyOf(input: ApiRequest): string {
  return input.kind === "fields" ? input.request.idempotency_key : input.idempotencyKey;
}

async function decide(context: ApiContext, input: ApiRequest): Promise<ProcessInvoiceResult> {
  const { config, db, organizationId } = context;
  const deps = processingDeps(config, db);
  if (input.kind === "fields") {
    return decidePaymentRequest(
      { ...deps, renderRequest: renderPaymentRequest },
      { organizationId, request: input.request },
    );
  }
  return decideApiDocument(deps, {
    organizationId,
    idempotencyKey: input.idempotencyKey,
    bytes: new Uint8Array(await input.file.arrayBuffer()),
    originalName: input.file.name,
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const context = await apiContext(request);
    if (context instanceof Response) return context;
    const { config, db, organizationId } = context;

    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    const input = contentType.startsWith("multipart/form-data")
      ? await readDocument(request, config.demo.maxUploadBytes)
      : await readFields(request);
    if (input instanceof Response) return input;

    await assertDemoLimits(config, db, organizationId, receiptKeyFor("api", keyOf(input)));
    const result = await decide(context, input);
    deliverNotificationsAfterResponse(organizationId);

    const body = apiDecisionBody({
      invoice: result.invoice,
      decision: result.decision,
      decidingRule: result.decision ? (decidingFinding(result.decision)?.code ?? null) : null,
      replayed: result.kind === "already_received",
      appUrl: config.publicAppUrl,
    });
    return Response.json(body, { status: result.kind === "decided" ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
