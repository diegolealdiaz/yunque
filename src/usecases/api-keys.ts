import type { Database } from "@/src/db/client";
import { findApiKeyByHash, saveApiKey } from "@/src/db/repositories";
import type { Ulid } from "@/src/domain";
import { API_KEY_PREFIX, apiKeyHash } from "@/src/session";

import { requireAccess } from "./demo-access";

/**
 * Llave de la API de decisión (D32). Solo la genera una empresa con el acceso de cliente
 * vigente, y vence con él: la API pone a trabajar al Lector con documentos de afuera, igual
 * que el correo real y Telegram. La llave se devuelve una sola vez; se guarda su huella.
 */

export type IssuedApiKey = { readonly key: string; readonly expiresAt: string };

/** Genera la llave de la empresa y anula la anterior. */
export async function issueApiKey(
  db: Database,
  input: { readonly organizationId: Ulid; readonly now: Date; readonly newKey: () => string },
): Promise<IssuedApiKey> {
  const grant = await requireAccess(db, input.organizationId, input.now);
  const key = input.newKey();
  await saveApiKey(db, {
    organizationId: input.organizationId,
    keyHash: apiKeyHash(key),
    createdAt: input.now.toISOString(),
    expiresAt: grant.expiresAt,
  });
  return { key, expiresAt: grant.expiresAt };
}

/**
 * La empresa dueña de la llave, o null si no existe, está mal formada o venció. Se busca por
 * huella: comparar la llave en sí no hace falta, y el largo de lo que manda el cliente no
 * revela nada.
 */
export async function authenticateApiKey(
  db: Database,
  key: string,
  now: Date,
): Promise<Ulid | null> {
  if (!key.startsWith(API_KEY_PREFIX) || key.length > 100) return null;
  const stored = await findApiKeyByHash(db, apiKeyHash(key));
  if (stored === null || stored.expiresAt <= now.toISOString()) return null;
  return stored.organizationId;
}
