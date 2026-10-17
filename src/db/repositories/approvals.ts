import { and, eq, isNull } from "drizzle-orm";

import { ApprovalSchema, type Approval, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { DbError, isUniqueViolation } from "../errors";
import { parseRow } from "../rows";
import { approvals } from "../schema";

/**
 * Aprobaciones: una por decisión. Dos personas que aprueban a la vez compiten por la
 * restricción única: exactamente una gana y la otra recibe `conflict`.
 */

/** Registra la resolución humana de una decisión; la segunda para la misma decisión da `conflict`. */
export async function insertApproval(exec: Executor, approval: Approval): Promise<void> {
  const a = ApprovalSchema.parse(approval);
  try {
    await exec.insert(approvals).values({
      id: a.id,
      organizationId: a.organization_id,
      invoiceId: a.invoice_id,
      decisionId: a.decision_id,
      outcome: a.outcome,
      approver: a.approver,
      checklist: [...a.checklist],
      reason: a.reason,
      payload: a.payload,
      signature: a.signature,
      consumedAt: a.consumed_at,
      createdAt: a.created_at,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DbError("conflict", "Esta decisión ya fue resuelta por otra persona");
    }
    throw error;
  }
}

function toApproval(row: typeof approvals.$inferSelect): Approval {
  return parseRow(
    ApprovalSchema,
    {
      id: row.id,
      organization_id: row.organizationId,
      invoice_id: row.invoiceId,
      decision_id: row.decisionId,
      outcome: row.outcome,
      approver: row.approver,
      checklist: row.checklist,
      reason: row.reason,
      payload: row.payload,
      signature: row.signature,
      consumed_at: row.consumedAt,
      created_at: row.createdAt,
    },
    "approvals",
  );
}

/** Aprobación de una decisión, o null si nadie la resolvió todavía. */
export async function findApprovalByDecision(
  exec: Executor,
  organizationId: Ulid,
  decisionId: Ulid,
): Promise<Approval | null> {
  const row = await exec.query.approvals.findFirst({
    where: and(eq(approvals.organizationId, organizationId), eq(approvals.decisionId, decisionId)),
  });
  return row ? toApproval(row) : null;
}

/** Marca la aprobación como consumida una sola vez. Si ya lo estaba, lanza `stale_state`. */
export async function consumeApproval(
  exec: Executor,
  organizationId: Ulid,
  approvalId: Ulid,
  now: string,
): Promise<void> {
  const result = await exec
    .update(approvals)
    .set({ consumedAt: now })
    .where(
      and(
        eq(approvals.organizationId, organizationId),
        eq(approvals.id, approvalId),
        isNull(approvals.consumedAt),
      ),
    );
  if (result.rowsAffected === 0) {
    throw new DbError("stale_state", "La aprobación ya fue consumida");
  }
}
