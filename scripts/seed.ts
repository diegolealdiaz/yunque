import "./env";

import { getConfig } from "@/src/config";
import { loadDatasetSources, loadDemoSeed } from "@/src/dataset";
import { closeDatabase, createDatabase, runMigrations } from "@/src/db/client";
import { loadSeedData, seedDatasetOrganization } from "@/src/db/seed";
import { createUlidGenerator } from "@/src/domain";

/**
 * Siembra la empresa ficticia en la base local: empresa, saldos, vendors, política v1, dos
 * meses de historial y lo ya comprometido del mes del dataset. Es idempotente: si la
 * empresa base (sin visitante) ya existe, no hace nada.
 */
async function main(): Promise<void> {
  const config = getConfig();
  const db = await createDatabase(config.database);
  try {
    await runMigrations(db);
    const existing = await db.query.organizations.findFirst();
    if (existing) {
      console.warn(`La base ya tiene la empresa ${existing.name}; no se siembra de nuevo`);
      return;
    }
    const [data, dataset, demo] = await Promise.all([
      loadSeedData(),
      loadDatasetSources(),
      loadDemoSeed(),
    ]);
    const result = await seedDatasetOrganization(db, {
      data,
      newId: createUlidGenerator(),
      now: () => new Date(),
      systemHardCapUsdCents: config.systemHardCapUsdCents,
      visitorId: null,
      history: dataset.history,
      historyDocuments: demo.historyDocuments,
      committedUsdCents: dataset.manifest.october_committed_usd_cents,
      today: dataset.manifest.today,
    });
    console.warn(
      `Sembrada ${result.organization.name} (${result.organization.id}) con ${String(result.vendors.length)} vendors y ${String(dataset.history.length)} facturas de historial`,
    );
  } finally {
    closeDatabase(db);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
