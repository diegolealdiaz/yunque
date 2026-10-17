import { connection } from "next/server";

import { getConfig } from "@/src/config";
import { healthRows } from "@/src/ui/health";

import { existingOrganization } from "../../_data/context";
import { healthReport } from "../../_data/health";

/**
 * Salud con frescura (docs/practicas.md 52): base, política vigente y proveedor del modelo,
 * más la antigüedad del pendiente más viejo y las escaladas abiertas. Responde 503 si falla
 * algo crítico, para que un monitor lo detecte sin leer el cuerpo. Nunca siembra una empresa
 * nueva ni expone secretos: solo estados y conteos.
 */
export async function GET(): Promise<Response> {
  // Cada consulta mide el estado de ese momento: nunca se prerenderiza ni se cachea.
  await connection();
  const config = getConfig();
  const report = await healthReport(
    async (db) => (await existingOrganization(db, config))?.id ?? null,
  );
  const now = new Date(report.checkedAt);
  const oldest = report.operation?.oldestWaitingSince ?? null;
  return Response.json(
    {
      status: report.status,
      checked_at: report.checkedAt,
      checks: healthRows(report, now).map((row) => ({
        name: row.key,
        ok: row.ok,
        detail: row.detail,
      })),
      pending: report.operation && {
        waiting: report.operation.waiting,
        expired: report.operation.expired,
        oldest_age_s:
          oldest === null ? null : Math.round((now.getTime() - Date.parse(oldest)) / 1000),
      },
    },
    {
      status: report.status === "falla" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
