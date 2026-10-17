import { and, asc, eq } from "drizzle-orm";

import { LlmCallSchema, type LlmCall, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { parseRow } from "../rows";
import { llmCalls } from "../schema";

/** Registro de llamadas al modelo: una fila por intento, con tokens, costo y latencia. */

/** Registra un intento de llamada al modelo. */
export async function insertLlmCall(exec: Executor, call: LlmCall): Promise<void> {
  const c = LlmCallSchema.parse(call);
  await exec.insert(llmCalls).values({
    id: c.id,
    organizationId: c.organization_id,
    invoiceId: c.invoice_id,
    model: c.model,
    promptVersion: c.prompt_version,
    promptHash: c.prompt_hash,
    rawOutput: c.raw_output,
    attempt: c.attempt,
    inputTokens: c.input_tokens,
    outputTokens: c.output_tokens,
    costUsdMicros: c.cost_usd_micros,
    latencyMs: c.latency_ms,
    status: c.status,
    traceId: c.trace_id,
    createdAt: c.created_at,
  });
}

/** Llamadas de una factura, en el orden en que ocurrieron. */
export async function listLlmCalls(
  exec: Executor,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<LlmCall[]> {
  const rows = await exec.query.llmCalls.findMany({
    where: and(eq(llmCalls.organizationId, organizationId), eq(llmCalls.invoiceId, invoiceId)),
    orderBy: [asc(llmCalls.createdAt), asc(llmCalls.id)],
  });
  return rows.map((row) =>
    parseRow(
      LlmCallSchema,
      {
        id: row.id,
        organization_id: row.organizationId,
        invoice_id: row.invoiceId,
        model: row.model,
        prompt_version: row.promptVersion,
        prompt_hash: row.promptHash,
        raw_output: row.rawOutput,
        attempt: row.attempt,
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        cost_usd_micros: row.costUsdMicros ?? 0,
        latency_ms: row.latencyMs,
        status: row.status,
        trace_id: row.traceId,
        created_at: row.createdAt,
      },
      "llm_calls",
    ),
  );
}
