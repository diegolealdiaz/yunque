import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { PaymentRequestSchema } from "../src/domain/payment-request";

import { YunqueApiError, type Decision, type YunqueClient } from "./yunque-client";

/**
 * Las herramientas MCP de Yunque (D32), las mismas para el servidor local (mcp/server.ts) y
 * para el remoto (app/api/mcp): cada una es una llamada a la API de decisión, y decidir sigue
 * siendo del motor de Yunque. La de archivos solo existe en el local, que puede leer el disco.
 */

/**
 * Llave de idempotencia obligatoria: una derivada del contenido haría que preguntar dos veces
 * por la misma factura devolviera «se puede pagar» las dos, y el asistente la pagaría dos
 * veces. Con una llave por pago, la misma factura con otra llave se frena como duplicada.
 */
const IdempotencyKey = PaymentRequestSchema.shape.idempotency_key.describe(
  "Única por pago, por ejemplo el número de factura con el proveedor. Repítela solo para reintentar la misma solicitud.",
);

/** La decisión en una frase para el asistente, con el porqué y el acta. */
function summary(d: Decision): string {
  const reasons = d.findings.map((f) => `- ${f.title}: ${f.detail}`);
  return [
    ...(d.replayed
      ? [
          "YA DECIDIDA ANTES con esta llave: es la misma decisión, no una nueva. Si ya la pagaste, no la pagues otra vez.",
        ]
      : []),
    `${d.verdict ?? "en proceso"} · ${d.reference} · ${d.headline}`,
    ...(reasons.length > 0 ? ["Por qué:", ...reasons] : []),
    d.next_step,
    ...(d.record_url ? [`Acta: ${d.record_url}`] : []),
  ].join("\n");
}

async function run(call: () => Promise<Decision>) {
  try {
    const decision = await call();
    return {
      content: [{ type: "text" as const, text: summary(decision) }],
      structuredContent: decision,
    };
  } catch (error) {
    const text =
      error instanceof YunqueApiError
        ? [
            error.message,
            ...error.issues.map((i) => `- ${i.path}: ${i.message}`),
            error.action,
          ].join("\n")
        : "No se pudo contactar a Yunque. Revisa la red y la dirección de Yunque.";
    return { content: [{ type: "text" as const, text }], isError: true };
  }
}

export function registerYunqueTools(
  server: McpServer,
  client: YunqueClient,
  options: { readonly files: boolean },
): void {
  server.registerTool(
    "decide_payment",
    {
      title: "Preguntar a Yunque si se puede pagar",
      description:
        'Antes de pagar una factura, pregúntale a Yunque. Responde pagar, frenar o escalar según las reglas de la empresa, con el porqué. Montos como texto decimal con punto ("1200.00"); moneda en código ISO. Si escala, una persona decide: consulta después con get_decision. Nunca pagues lo que Yunque frenó o escaló.',
      inputSchema: PaymentRequestSchema.extend({ idempotency_key: IdempotencyKey }),
    },
    (request) => run(() => client.decidePayment(request)),
  );

  if (options.files) {
    server.registerTool(
      "decide_invoice_file",
      {
        title: "Mandar una factura a Yunque",
        description:
          "Manda el PDF o la foto de una factura del disco local a Yunque, que la lee y decide pagar, frenar o escalar con el porqué.",
        inputSchema: z.object({
          path: z.string().min(1).describe("Ruta local del PDF, PNG o JPEG"),
          idempotency_key: IdempotencyKey,
        }),
      },
      ({ path, idempotency_key }) => run(() => client.decideFile(path, idempotency_key)),
    );
  }

  server.registerTool(
    "get_decision",
    {
      title: "Consultar una decisión de Yunque",
      description:
        "Estado vigente de una solicitud por su referencia (YQ-...). Úsala para saber si una persona aprobó o rechazó lo que escaló.",
      inputSchema: z.object({ reference: z.string().min(1) }),
    },
    ({ reference }) => run(() => client.getDecision(reference)),
  );
}
