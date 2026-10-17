import { invoicePageKey } from "@/src/usecases";

import { appContext } from "../../../../../_data/context";
import { fileStorage } from "../../../../../_data/storage";

/**
 * Imagen de una página de una factura (D11): el navegador nunca recibe el PDF original, solo
 * el PNG que el servidor renderizó al ingerir. Se entrega únicamente si la factura es de la
 * empresa de quien pide; si no, responde igual que una inexistente.
 */

const TYPES: Readonly<Record<string, string>> = { png: "image/png", jpg: "image/jpeg" };

function notFound(): Response {
  return new Response("No existe", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
): Promise<Response> {
  const { id, n } = await params;
  const page = /^[1-9][0-9]?$/.test(n) ? Number(n) : 0;
  const { db, organization } = await appContext();
  const key = page === 0 ? null : await invoicePageKey(db, organization.id, id, page);
  const extension = key?.split(".").pop() ?? "";
  const type = TYPES[extension];
  if (!key || !type) return notFound();

  const bytes = await fileStorage().get(key);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // Privada: solo el navegador de quien pide la guarda, nunca una caché compartida.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
