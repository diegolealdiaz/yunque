import { and, count, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { UlidSchema, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { parseRow } from "../rows";
import { accessAttempts, accessGrants } from "../schema";

/**
 * Acceso de cliente de la demo (D23, D24): una fila por empresa con su vencimiento. Volver a
 * escribir el código después de vencido renueva la misma fila. Los intentos fallidos del
 * código se cuentan por empresa para limitarlos.
 */

const AccessGrantSchema = z.strictObject({
  organizationId: UlidSchema,
  grantedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type AccessGrant = Readonly<z.infer<typeof AccessGrantSchema>>;

/** Guarda o renueva el acceso de la empresa. */
export async function saveAccessGrant(exec: Executor, grant: AccessGrant): Promise<void> {
  const g = AccessGrantSchema.parse(grant);
  await exec
    .insert(accessGrants)
    .values(g)
    .onConflictDoUpdate({
      target: accessGrants.organizationId,
      set: { grantedAt: g.grantedAt, expiresAt: g.expiresAt },
    });
}

/** El acceso de la empresa, vencido o no; null si nunca tuvo. */
export async function getAccessGrant(
  exec: Executor,
  organizationId: Ulid,
): Promise<AccessGrant | null> {
  const [row] = await exec
    .select()
    .from(accessGrants)
    .where(eq(accessGrants.organizationId, organizationId))
    .limit(1);
  return row ? parseRow(AccessGrantSchema, row, "access_grants") : null;
}

const AccessAttemptSchema = z.strictObject({
  id: UlidSchema,
  organizationId: UlidSchema,
  attemptedAt: z.iso.datetime(),
});
export type AccessAttempt = Readonly<z.infer<typeof AccessAttemptSchema>>;

/** Registra un intento fallido del código de acceso. */
export async function insertAccessAttempt(exec: Executor, attempt: AccessAttempt): Promise<void> {
  await exec.insert(accessAttempts).values(AccessAttemptSchema.parse(attempt));
}

/** Intentos fallidos de la empresa desde `since`. */
export async function countAccessAttemptsSince(
  exec: Executor,
  organizationId: Ulid,
  since: string,
): Promise<number> {
  const [row] = await exec
    .select({ n: count() })
    .from(accessAttempts)
    .where(
      and(
        eq(accessAttempts.organizationId, organizationId),
        gte(accessAttempts.attemptedAt, since),
      ),
    );
  return row?.n ?? 0;
}
