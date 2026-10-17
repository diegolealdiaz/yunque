import { and, desc, eq } from "drizzle-orm";

import {
  PolicyVersionSchema,
  parsePolicy,
  policyHash,
  type Policy,
  type PolicyVersion,
  type Ulid,
  type UlidGenerator,
} from "@/src/domain";

import type { Executor } from "../client";
import { DbError, isUniqueViolation } from "../errors";
import { policyVersions } from "../schema";

/**
 * Versiones de política: append-only. La versión nueva es la última más uno; si dos
 * escrituras compiten, la restricción única hace fallar a la segunda con `conflict`.
 */

function toPolicyVersion(row: typeof policyVersions.$inferSelect): PolicyVersion {
  return PolicyVersionSchema.parse({
    id: row.id,
    organization_id: row.organizationId,
    version: row.version,
    content: row.content,
    content_hash: row.contentHash,
    signed_by: row.signedBy,
    signed_at: row.signedAt,
    ...(row.note === null ? {} : { note: row.note }),
  });
}

export async function getCurrentPolicy(
  exec: Executor,
  organizationId: Ulid,
): Promise<PolicyVersion | null> {
  const row = await exec.query.policyVersions.findFirst({
    where: eq(policyVersions.organizationId, organizationId),
    orderBy: [desc(policyVersions.version)],
  });
  return row ? toPolicyVersion(row) : null;
}

export async function getPolicyVersion(
  exec: Executor,
  organizationId: Ulid,
  id: Ulid,
): Promise<PolicyVersion> {
  const row = await exec.query.policyVersions.findFirst({
    where: and(eq(policyVersions.organizationId, organizationId), eq(policyVersions.id, id)),
  });
  if (!row) throw new DbError("not_found", `Versión de política ${id} no existe`);
  return toPolicyVersion(row);
}

export async function listPolicyVersions(
  exec: Executor,
  organizationId: Ulid,
): Promise<PolicyVersion[]> {
  const rows = await exec.query.policyVersions.findMany({
    where: eq(policyVersions.organizationId, organizationId),
    orderBy: [desc(policyVersions.version)],
  });
  return rows.map(toPolicyVersion);
}

export async function appendPolicyVersion(
  exec: Executor,
  organizationId: Ulid,
  input: { content: Policy; signedBy: string; signedAt: string; note?: string },
  newId: UlidGenerator,
): Promise<PolicyVersion> {
  const content = parsePolicy(input.content);
  const current = await getCurrentPolicy(exec, organizationId);
  const version: PolicyVersion = PolicyVersionSchema.parse({
    id: newId(),
    organization_id: organizationId,
    version: (current?.version ?? 0) + 1,
    content,
    content_hash: policyHash(content),
    signed_by: input.signedBy,
    signed_at: input.signedAt,
    ...(input.note === undefined ? {} : { note: input.note }),
  });
  try {
    await exec.insert(policyVersions).values({
      id: version.id,
      organizationId: version.organization_id,
      version: version.version,
      content: version.content,
      contentHash: version.content_hash,
      signedBy: version.signed_by,
      signedAt: version.signed_at,
      note: version.note ?? null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DbError("conflict", "Otra versión de política se guardó al mismo tiempo", true);
    }
    throw error;
  }
  return version;
}
