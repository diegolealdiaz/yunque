import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerYunqueTools } from "./tools";
import { createYunqueClient } from "./yunque-client";

/**
 * Servidor MCP de Yunque (D32): deja que un asistente, como Claude, le pregunte a Yunque si
 * puede pagar una factura antes de pagarla. Es un cliente delgado de la API de decisión: cada
 * herramienta es una llamada HTTP, y decidir sigue siendo del motor de Yunque.
 *
 * Variables: `YUNQUE_API_KEY` (la llave de la pantalla «Conectar») y, opcional, `YUNQUE_URL`.
 */

const DEFAULT_URL = "https://yunque-weld.vercel.app";

const apiKey = process.env["YUNQUE_API_KEY"];
if (!apiKey) {
  process.stderr.write("Falta YUNQUE_API_KEY: genérala en Yunque, en «Conectar».\n");
  process.exit(1);
}
const client = createYunqueClient({ baseUrl: process.env["YUNQUE_URL"] ?? DEFAULT_URL, apiKey });

const server = new McpServer({ name: "yunque", version: "1.0.0" });
registerYunqueTools(server, client, { files: true });

await server.connect(new StdioServerTransport());
