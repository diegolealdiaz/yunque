import { getConfig, type Config, type InboundEmailConfig } from "@/src/config";
import { getDatabase, type Database } from "@/src/db/client";

/**
 * Contexto del webhook de correo (D23). No hay cookie de visitante: la empresa sale de la
 * dirección a la que escribieron. Null si el correo de entrada está apagado o fuera de la
 * demo: la ruta responde 404.
 */
export async function inboundContext(): Promise<{
  readonly config: Config;
  readonly inbound: InboundEmailConfig;
  readonly db: Database;
} | null> {
  const config = getConfig();
  const inbound = config.demo.enabled ? config.inboundEmail : null;
  if (inbound === null) return null;
  return { config, inbound, db: await getDatabase(config.database) };
}
