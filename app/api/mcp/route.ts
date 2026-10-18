import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { registerYunqueTools } from "@/mcp/tools";
import { createYunqueClient } from "@/mcp/yunque-client";

import { apiContext } from "../../_data/api";

/**
 * Servidor MCP remoto (D32): un agente (Claude, u otro que hable MCP) se conecta con la URL de
 * Yunque y su llave, sin instalar nada. Es solo un adaptador de protocolo: cada herramienta
 * llama a la API de decisión con la misma llave, así los topes, la idempotencia y las reglas
 * viven en un solo lugar. Sin sesión: cada petición trae su llave y se atiende sola.
 */

/** Una herramienta llama a la API, que lee y decide: el mismo margen que la API. */
export const maxDuration = 90;

async function handle(request: Request): Promise<Response> {
  const context = await apiContext(request);
  if (context instanceof Response) return context;
  const key = /^bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const server = new McpServer({ name: "yunque", version: "1.0.0" });
  registerYunqueTools(
    server,
    createYunqueClient({ baseUrl: new URL(request.url).origin, apiKey: key }),
    {
      files: false,
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
