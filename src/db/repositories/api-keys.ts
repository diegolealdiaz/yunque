import { eq } from "drizzle-orm";
import { z } from "zod";

import { UlidSchema } from "@/src/domain";

import type { Executor } from "../client";
import { parseRow } from "../rows";
import { apiKeys } from "../schema";

/**
 * Llave de la API de decisión (D32): una fila por empresa con la huella de su llave vigente.
 * Generar otra reescribe la fila, así la anterior deja de valer en el mismo instante.
 */

const ApiKeySchema = z.strictObject({
  organizationId: UlidSchema,
  keyHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type ApiKey = Readonly<z.infer<typeof ApiKeySchema>>;

/** Guarda la llave de la empresa, reemplazando la anterior. */
export async function saveApiKey(exec: Executor, key: ApiKey): Promise<void> {
  const k = ApiKeySchema.parse(key);
  await exec
    .insert(apiKeys)
    .values(k)
    .onConflictDoUpdate({
      target: apiKeys.organizationId,
      set: { keyHash: k.keyHash, createdAt: k.createdAt, expiresAt: k.expiresAt },
    });
}

/** La llave con esa huella, vencida o no; null si no existe. */
export async function findApiKeyByHash(exec: Executor, keyHash: string): Promise<ApiKey | null> {
  const [row] = await exec.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
  return row ? parseRow(ApiKeySchema, row, "api_keys") : null;
}
