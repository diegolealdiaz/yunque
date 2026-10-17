import "./env";

import { closeDatabase, createDatabase, runMigrations } from "@/src/db/client";
import { getConfig } from "@/src/config";

/** Aplica las migraciones pendientes sobre la base de la configuración. */
async function main(): Promise<void> {
  const config = getConfig();
  const db = await createDatabase(config.database);
  try {
    await runMigrations(db);
    console.warn(`Migraciones aplicadas en ${config.database.url}`);
  } finally {
    closeDatabase(db);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
