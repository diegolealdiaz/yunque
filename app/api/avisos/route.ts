import { connection } from "next/server";

import { getConfig } from "@/src/config";
import { getDatabase } from "@/src/db/client";
import { listOrganizationsWithDueNotifications } from "@/src/db/repositories";
import { sameSecret } from "@/src/session";

import { deliverNotifications } from "../../_data/notify";

/**
 * Cron de avisos (vercel.json): entrega los avisos atrasados de todas las empresas. Cada
 * decisión ya entrega los suyos al responder; esta ruta recoge los que fallaron y esperan su
 * reintento sin que nadie vuelva a decidir. Solo la llama Vercel, con `CRON_SECRET` en
 * `Authorization: Bearer`; sin el secreto configurado, la ruta queda cerrada.
 */

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  await connection();
  const config = getConfig();
  const expected = config.secrets.cron;
  const given = request.headers.get("authorization") ?? "";
  if (expected === null || !sameSecret(given, `Bearer ${expected}`)) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }
  const db = await getDatabase(config.database);
  const organizations = await listOrganizationsWithDueNotifications(db, new Date().toISOString());
  // Una empresa a la vez: la entrega nunca lanza y cada una reclama sus avisos por separado.
  for (const organizationId of organizations) await deliverNotifications(organizationId);
  return Response.json({ status: "ok", organizations: organizations.length });
}
