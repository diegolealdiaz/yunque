import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDatabase, createDatabase, runMigrations, type Database } from "@/src/db/client";
import { loadSeedData, seedOrganization, type SeedResult } from "@/src/db/seed";
import { createUlidGenerator, type UlidGenerator } from "@/src/domain";

/** Base SQLite en un archivo temporal, migrada de cero. Se borra al cerrar. */
export type TestDatabase = {
  readonly db: Database;
  readonly newId: UlidGenerator;
  readonly now: () => Date;
  close(): Promise<void>;
};

export async function openTestDatabase(): Promise<TestDatabase> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "yunque-test-"));
  const db = await createDatabase({ url: `file:${path.join(dir, "test.db")}` });
  await runMigrations(db);
  let tick = Date.UTC(2026, 9, 17, 12, 0, 0);
  return {
    db,
    newId: createUlidGenerator(),
    now: () => new Date((tick += 1000)),
    async close() {
      closeDatabase(db);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function seedTestOrganization(
  t: TestDatabase,
  visitorId: string | null = null,
): Promise<SeedResult> {
  const data = await loadSeedData();
  return seedOrganization(t.db, {
    data,
    newId: t.newId,
    now: t.now,
    systemHardCapUsdCents: 10_000_000,
    visitorId,
  });
}
