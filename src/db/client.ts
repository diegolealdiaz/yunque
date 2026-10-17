import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";

import * as schema from "./schema";

/**
 * Único módulo que importa el driver. El resto del sistema recibe un `Database` o un
 * `Executor` (base o transacción) por parámetro y nunca abre conexiones por su cuenta.
 */

export type Database = LibSQLDatabase<typeof schema> & { $client: Client };
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Base o transacción: los repositorios aceptan cualquiera de los dos. */
export type Executor = Database | Transaction;

export type DatabaseOptions = {
  readonly url: string;
  readonly authToken?: string | null;
};

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "src", "db", "migrations");

/** Abre la base. Para archivos locales activa WAL y claves foráneas. */
export async function createDatabase(options: DatabaseOptions): Promise<Database> {
  const client = createClient({
    url: options.url,
    authToken: options.authToken ?? undefined,
  });
  if (options.url.startsWith("file:")) {
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA busy_timeout = 5000");
  }
  await client.execute("PRAGMA foreign_keys = ON");
  return drizzle({ client, schema });
}

/** Aplica las migraciones pendientes de `src/db/migrations`, en orden y una sola vez. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export function closeDatabase(db: Database): void {
  db.$client.close();
}

let shared: Promise<Database> | undefined;

/** Base del proceso, abierta una sola vez con la configuración validada. */
export function getDatabase(options: DatabaseOptions): Promise<Database> {
  shared ??= createDatabase(options);
  return shared;
}
