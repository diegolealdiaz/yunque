import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { PaymentRequest } from "../src/domain/payment-request";

/**
 * Cliente de la API de decisión de Yunque (D32) para el servidor MCP. Solo habla HTTP con la
 * API: no decide nada ni toca la base. Todo lo que valida y decide ocurre en el servidor.
 */

export type YunqueClientConfig = { readonly baseUrl: string; readonly apiKey: string };

/** Lo que el servidor MCP necesita de la respuesta; el resto se pasa tal cual al asistente. */
const DecisionSchema = z.looseObject({
  reference: z.string(),
  status: z.string(),
  verdict: z.string().nullable(),
  deciding_rule: z.string().nullable(),
  headline: z.string(),
  next_step: z.string(),
  findings: z.array(z.looseObject({ title: z.string(), detail: z.string() })),
  record_url: z.string().nullable(),
  replayed: z.boolean(),
});
export type Decision = z.infer<typeof DecisionSchema>;

const ErrorSchema = z.looseObject({
  error: z.object({ code: z.string(), message: z.string(), action: z.string() }),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export class YunqueApiError extends Error {
  constructor(
    message: string,
    readonly action: string,
    readonly issues: readonly { readonly path: string; readonly message: string }[] = [],
  ) {
    super(message);
    this.name = "YunqueApiError";
  }
}

/** Tipos de archivo que la API acepta como documento. */
const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const MAX_DOCUMENT_BYTES = 10_000_000;

export function createYunqueClient(config: YunqueClientConfig) {
  const base = config.baseUrl.replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${config.apiKey}` };

  async function send(url: string, init: RequestInit): Promise<Decision> {
    const response = await fetch(url, init);
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ErrorSchema.safeParse(json);
      if (parsed.success) {
        const { message, action } = parsed.data.error;
        throw new YunqueApiError(message, action, parsed.data.issues ?? []);
      }
      throw new YunqueApiError(
        `Yunque respondió ${String(response.status)}`,
        "Revisa la URL de Yunque y vuelve a intentar",
      );
    }
    return DecisionSchema.parse(json);
  }

  return {
    /** Decide una solicitud con los campos de la factura. */
    decidePayment(request: PaymentRequest): Promise<Decision> {
      return send(`${base}/api/decide`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    },

    /** Decide un PDF o una imagen del disco local. */
    async decideFile(filePath: string, idempotencyKey: string): Promise<Decision> {
      const type = DOCUMENT_TYPES[path.extname(filePath).toLowerCase()];
      if (type === undefined) {
        throw new YunqueApiError(
          "El archivo no es PDF, PNG ni JPEG",
          "Usa la factura en PDF o como foto",
        );
      }
      if ((await stat(filePath)).size > MAX_DOCUMENT_BYTES) {
        throw new YunqueApiError("El archivo pesa más de 10 MB", "Usa una versión más liviana");
      }
      const bytes = await readFile(filePath);
      const form = new FormData();
      form.set("file", new Blob([bytes], { type }), path.basename(filePath));
      form.set("idempotency_key", idempotencyKey);
      return send(`${base}/api/decide`, { method: "POST", headers: auth, body: form });
    },

    /** Estado vigente de una solicitud, por su referencia. */
    getDecision(reference: string): Promise<Decision> {
      return send(`${base}/api/decide/${encodeURIComponent(reference)}`, { headers: auth });
    },
  };
}

export type YunqueClient = ReturnType<typeof createYunqueClient>;
