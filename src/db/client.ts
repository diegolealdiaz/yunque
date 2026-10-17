import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";

import { DbError, isBusy, toDbError } from "./errors";
import * as schema from "./schema";

/**
 * Único módulo que importa el driver. El resto del sistema recibe un `Database` o un
 * `Executor` (base o transacción) por parámetro y nunca abre conexiones por su cuenta.
 *
 * Escrituras: SQLite admite un solo escritor a la vez y el cliente abre un pool de
 * conexiones, así que dos `db.transaction` concurrentes chocan con `SQLITE_BUSY`.
 * `withWriteTransaction` serializa las transacciones de escritura dentro del proceso y
 * reintenta con espera creciente si otro proceso tiene el bloqueo.
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

/**
 * Abre la base. Para archivos locales activa WAL. Las claves foráneas las activa el cliente
 * de libSQL en cada conexión del pool; en Turso dependen del servidor y se verifican en el
 * paso de producción.
 */
export async function createDatabase(options: DatabaseOptions): Promise<Database> {
  const client = createClient({
    url: options.url,
    authToken: options.authToken ?? undefined,
  });
  if (options.url.startsWith("file:")) {
    await client.execute("PRAGMA journal_mode = WAL");
  }
  return drizzle({ client, schema });
}

/** Aplica las migraciones pendientes de `src/db/migrations`, en orden y una sola vez. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Cierra la conexión y olvida la instancia compartida si era esta. */
/** Comprueba que la base responde: una consulta trivial. Lanza si no hay conexión. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.$client.execute("select 1");
}

export function closeDatabase(db: Database): void {
  db.$client.close();
  if (sharedInstance === db) {
    shared = undefined;
    sharedInstance = undefined;
  }
}

let shared: Promise<Database> | undefined;
let sharedInstance: Database | undefined;

/**
 * Base del proceso, abierta una sola vez. Un fallo al abrir no queda cacheado: la siguiente
 * llamada vuelve a intentar. Las opciones solo cuentan en la primera llamada que prospera.
 */
export function getDatabase(options: DatabaseOptions): Promise<Database> {
  shared ??= createDatabase(options).then(
    (db) => {
      sharedInstance = db;
      return db;
    },
    (error: unknown) => {
      shared = undefined;
      throw error;
    },
  );
  return shared;
}

const WRITE_RETRIES = 5;
const RETRY_BASE_MS = 25;

/** Cola de escritura por instancia de base: una transacción de escritura a la vez. */
const writeQueues = new WeakMap<Database, Promise<unknown>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta `fn` dentro de una transacción de escritura serializada. Si la base está
 * ocupada por otro proceso, reintenta hasta `WRITE_RETRIES` veces con espera creciente;
 * después lanza `DbError("busy")`. Los errores del driver conocidos salen como `DbError`.
 */
export async function withWriteTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const previous = writeQueues.get(db) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeQueues.set(
    db,
    previous.then(() => mine),
  );
  await previous.catch(() => undefined);
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        return await db.transaction(fn);
      } catch (error) {
        if (isBusy(error) && attempt < WRITE_RETRIES) {
          await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        if (isBusy(error)) throw new DbError("busy", "La base sigue ocupada tras reintentar", true);
        throw toDbError(error);
      }
    }
  } finally {
    release();
  }
}
