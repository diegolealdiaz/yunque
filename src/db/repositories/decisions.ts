import { and, desc, eq } from "drizzle-orm";

import { DecisionSchema, type Decision, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { DbError } from "../errors";
import { decisions } from "../schema";

/** Decisiones: append-only. La vigente de una factura es la última por fecha. */

export async function insertDecision(exec: Executor, decision: Decision): Promise<void> {
  const d = DecisionSchema.parse(decision);
  await exec.insert(decisions).values({
    id: d.id,
    organizationId: d.organization_id,
    invoiceId: d.invoice_id,
    verdict: d.verdict,
    findings: [...d.findings],
    explanation: d.explanation,
    summary: d.summary,
    scheduledFor: d.scheduled_for,
    paymentOrder: d.payment_order,
    amount: d.amount?.amount ?? null,
    amountCurrency: d.amount?.currency ?? null,
    amountUsd: d.amount_usd?.amount ?? null,
    vendorId: d.vendor_id,
    policyVersionId: d.policy_version_id,
    policyHash: d.policy_hash,
    documentHash: d.document_hash,
    extractionHash: d.extraction_hash,
    fieldSources: d.field_sources,
    previousDecisionId: d.previous_decision_id,
    dryRun: d.dry_run,
    actor: d.actor,
    costUsdMicros: d.cost_usd_micros,
    latencyMs: d.latency_ms,
    decidedAt: d.decided_at,
  });
}

function toDecision(row: typeof decisions.$inferSelect): Decision {
  return DecisionSchema.parse({
    id: row.id,
    organization_id: row.organizationId,
    invoice_id: row.invoiceId,
    verdict: row.verdict,
    findings: row.findings,
    explanation: row.explanation,
    summary: row.summary,
    scheduled_for: row.scheduledFor,
    payment_order: row.paymentOrder ?? null,
    amount:
      row.amount === null || row.amountCurrency === null
        ? null
        : { amount: row.amount, currency: row.amountCurrency },
    amount_usd: row.amountUsd === null ? null : { amount: row.amountUsd, currency: "USD" },
    vendor_id: row.vendorId,
    policy_version_id: row.policyVersionId,
    policy_hash: row.policyHash,
    document_hash: row.documentHash,
    extraction_hash: row.extractionHash,
    field_sources: row.fieldSources,
    previous_decision_id: row.previousDecisionId,
    dry_run: row.dryRun,
    actor: row.actor,
    cost_usd_micros: row.costUsdMicros,
    latency_ms: row.latencyMs,
    decided_at: row.decidedAt,
  });
}

export async function getDecision(
  exec: Executor,
  organizationId: Ulid,
  id: Ulid,
): Promise<Decision> {
  const row = await exec.query.decisions.findFirst({
    where: and(eq(decisions.organizationId, organizationId), eq(decisions.id, id)),
  });
  if (!row) throw new DbError("not_found", `Decisión ${id} no existe`);
  return toDecision(row);
}

export async function getLatestDecision(
  exec: Executor,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<Decision | null> {
  const row = await exec.query.decisions.findFirst({
    where: and(eq(decisions.organizationId, organizationId), eq(decisions.invoiceId, invoiceId)),
    orderBy: [desc(decisions.decidedAt), desc(decisions.id)],
  });
  return row ? toDecision(row) : null;
}

export async function listDecisions(
  exec: Executor,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<Decision[]> {
  const rows = await exec.query.decisions.findMany({
    where: and(eq(decisions.organizationId, organizationId), eq(decisions.invoiceId, invoiceId)),
    orderBy: [desc(decisions.decidedAt), desc(decisions.id)],
  });
  return rows.map(toDecision);
}
