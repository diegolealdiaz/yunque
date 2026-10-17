import { getConfig } from "@/src/config";
import { getDatabase, type Database } from "@/src/db/client";
import { loadSeedData } from "@/src/db/seed";
import type { Ulid } from "@/src/domain";
import { checkHealth, type HealthReport } from "@/src/usecases";

/**
 * Salud del sistema para una empresa (o sin ella, en una visita nueva). La comparten la
 * pantalla de Salud, la barra lateral y `/api/health`.
 */
export async function healthReport(
  resolveOrganization: (db: Database) => Promise<Ulid | null>,
): Promise<HealthReport> {
  const config = getConfig();
  let db: Database | null = null;
  let connectError: string | null = null;
  try {
    db = await getDatabase(config.database);
  } catch (error) {
    // Solo el tipo: el mensaje del driver puede traer la URL de la base.
    connectError = error instanceof Error ? error.name : "Error desconocido";
  }
  return checkHealth({
    db,
    connectError,
    // Si la base no contesta, la empresa queda sin resolver y el ping dirá por qué.
    organizationId: db ? await resolveOrganization(db).catch(() => null) : null,
    templateReady: () =>
      loadSeedData().then(
        () => true,
        () => false,
      ),
    model: config.model ? { primary: config.model.primary } : null,
    now: new Date(),
  });
}
