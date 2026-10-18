import type { Database } from "@/src/db/client";
import { findInvoiceByReference, getLatestDecision } from "@/src/db/repositories";
import {
  documentHash,
  paymentRequestLines,
  receiptKeyFor,
  type Decision,
  type Invoice,
  type PaymentRequest,
  type PaymentRequestLine,
  type Ulid,
} from "@/src/domain";

import { UseCaseError } from "./errors";
import {
  processInvoice,
  type ProcessInvoiceDeps,
  type ProcessInvoiceResult,
} from "./process-invoice";
import { createRequestReader } from "./request-reader";

/**
 * API de decisión para otros agentes (D32). Las dos formas de pedir terminan en
 * `processInvoice`, con la llave de recepción `api:<idempotency_key>`: misma política, mismo
 * motor, mismo registro que cualquier canal.
 */

/**
 * Arma el PDF de una solicitud (`renderPaymentRequest`). Llega inyectado: el generador de PDF
 * es pesado y así no lo carga cada ruta que usa los casos de uso.
 */
export type RenderPaymentRequest = (lines: readonly PaymentRequestLine[]) => Promise<Uint8Array>;

/**
 * Con campos: el documento sale de la misma solicitud que se va a leer, aquí, así nunca se
 * decide una solicitud sobre el documento de otra. Se lee sin modelo.
 */
export async function decidePaymentRequest(
  deps: ProcessInvoiceDeps & { readonly renderRequest: RenderPaymentRequest },
  input: { readonly organizationId: Ulid; readonly request: PaymentRequest },
): Promise<ProcessInvoiceResult> {
  const { request } = input;
  return processApiRequest(
    { ...deps, reader: createRequestReader(request) },
    {
      organizationId: input.organizationId,
      idempotencyKey: request.idempotency_key,
      bytes: await deps.renderRequest(paymentRequestLines(request)),
      originalName: "solicitud-de-pago.pdf",
    },
  );
}

/** Con documento: un PDF o una imagen que lee el Lector, como una subida. */
export async function decideApiDocument(
  deps: ProcessInvoiceDeps,
  input: {
    readonly organizationId: Ulid;
    readonly idempotencyKey: string;
    readonly bytes: Uint8Array;
    readonly originalName: string;
  },
): Promise<ProcessInvoiceResult> {
  return processApiRequest(deps, input);
}

/**
 * La llave de idempotencia identifica una solicitud, no solo una entrega: repetirla con otro
 * documento no puede devolver la decisión de la primera como si fuera de esta. Un agente que
 * reintenta manda lo mismo; uno que reusa la llave para otro pago recibe el error.
 *
 * Se comprueba con lo que `processInvoice` devolvió, no antes de llamarlo: dos solicitudes
 * simultáneas con la misma llave pasan juntas cualquier consulta previa, y la que pierde la
 * carrera recibe la factura de la que ganó.
 */
async function processApiRequest(
  deps: ProcessInvoiceDeps,
  input: {
    readonly organizationId: Ulid;
    readonly idempotencyKey: string;
    readonly bytes: Uint8Array;
    readonly originalName: string;
  },
): Promise<ProcessInvoiceResult> {
  const result = await processInvoice(deps, {
    organizationId: input.organizationId,
    channel: "api",
    receiptKey: receiptKeyFor("api", input.idempotencyKey),
    bytes: input.bytes,
    originalName: input.originalName,
  });
  if (
    result.kind === "already_received" &&
    result.invoice.document_hash !== documentHash(input.bytes)
  ) {
    throw new UseCaseError(
      "rejected_document",
      "Esa llave de idempotencia ya se usó con otra solicitud",
      {
        action: "Usa una llave nueva para cada pago; repite la misma solo para reintentar",
        severity: "warning",
      },
    );
  }
  return result;
}

/**
 * Estado vigente de una solicitud, por su referencia: así el agente que recibió `escalar`
 * sabe cuándo una persona la aprobó o la rechazó. Solo las que llegaron por la API: la llave
 * de una empresa no lee las facturas de sus otros canales. Null si no existe.
 */
export async function apiDecisionByReference(
  db: Database,
  organizationId: Ulid,
  reference: string,
): Promise<{ readonly invoice: Invoice; readonly decision: Decision | null } | null> {
  const invoice = await findInvoiceByReference(db, organizationId, reference);
  if (invoice === null || invoice.channel !== "api") return null;
  return { invoice, decision: await getLatestDecision(db, organizationId, invoice.id) };
}
