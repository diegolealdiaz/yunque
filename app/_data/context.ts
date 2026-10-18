import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { getConfig, type Config } from "@/src/config";
import { loadDemoSeed } from "@/src/dataset/demo-seed";
import { getDatabase, type Database } from "@/src/db/client";
import { DbError } from "@/src/db/errors";
import { findBaseOrganization, findOrganizationByVisitor } from "@/src/db/repositories";
import { loadSeedData, seedDatasetOrganization } from "@/src/db/seed";
import { createUlidGenerator, type Organization } from "@/src/domain";
import { VISITOR_COOKIE, verifyVisitor } from "@/src/session";

/**
 * Contexto de cada petición de la app, solo en el servidor: configuración, base y la empresa
 * de quien pide. Se calcula una vez por petición (`cache`) y lo comparten el armazón y la
 * pantalla.
 *
 * La empresa sale siempre de lo que el servidor verifica, nunca de lo que manda el cliente:
 * - En la demo, de la cookie firmada del visitante. Al primer acceso se siembra su copia de
 *   la empresa ficticia con el historial del dataset.
 * - Fuera de la demo, la empresa base de la base de datos.
 */

export type AppContext = {
  readonly config: Config;
  readonly db: Database;
  readonly organization: Organization;
};

const newId = createUlidGenerator();

/** Copia de la demo de un visitante: la existente, o una nueva sembrada al primer acceso. */
async function visitorOrganization(
  db: Database,
  config: Config,
  visitorId: string,
): Promise<Organization> {
  const existing = await findOrganizationByVisitor(db, visitorId);
  if (existing) return existing;
  const [data, seed] = await Promise.all([loadSeedData(), loadDemoSeed()]);
  try {
    const seeded = await seedDatasetOrganization(db, {
      data,
      newId,
      now: () => new Date(),
      systemHardCapUsdCents: config.systemHardCapUsdCents,
      visitorId,
      history: seed.history,
      historyDocuments: seed.historyDocuments,
      committedUsdCents: seed.committedUsdCents,
      today: seed.today,
    });
    return seeded.organization;
  } catch (error) {
    // Dos pestañas del mismo visitante a la vez: la restricción única deja una sola copia.
    const winner = await findOrganizationByVisitor(db, visitorId);
    if (winner) return winner;
    throw error;
  }
}

export const appContext = cache(async (): Promise<AppContext> => {
  // Toda pantalla depende de quién pide: se renderiza por petición, nunca al compilar. Va
  // primero para que el build no llegue a leer configuración ni secretos.
  await connection();
  const config = getConfig();
  const db = await getDatabase(config.database);
  if (config.demo.enabled) {
    const jar = await cookies();
    const visitorId = verifyVisitor(jar.get(VISITOR_COOKIE)?.value, config.secrets.session);
    if (visitorId === null) {
      // El proxy entrega la cookie antes de renderizar; sin ella, la petición no pasó por él.
      throw new DbError("not_found", "La visita no tiene una sesión válida");
    }
    return { config, db, organization: await visitorOrganization(db, config, visitorId) };
  }
  const organization = await findBaseOrganization(db);
  if (!organization) {
    throw new DbError("not_found", "No hay empresa sembrada: corre npm run seed");
  }
  return { config, db, organization };
});

/**
 * La empresa de quien pregunta, si ya existe, sin sembrar una nueva. La usa `/api/health`:
 * un monitor que consulta sin cookie no debe crear una empresa por cada consulta.
 */
export async function existingOrganization(
  db: Database,
  config: Config,
): Promise<Organization | null> {
  if (!config.demo.enabled) return findBaseOrganization(db);
  const jar = await cookies();
  const visitorId = verifyVisitor(jar.get(VISITOR_COOKIE)?.value, config.secrets.session);
  return visitorId === null ? null : findOrganizationByVisitor(db, visitorId);
}
