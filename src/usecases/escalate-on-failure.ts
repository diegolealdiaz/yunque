import { withWriteTransaction } from "@/src/db/client";
import { appendEvent, getCurrentPolicy, transitionInvoice } from "@/src/db/repositories";
import type { Decision, Finding, Invoice, Organization, PolicyVersion } from "@/src/domain";
import { explainDecision } from "@/src/explain";

import { auditEvent, hasTelegramChat, savedInvoice, type DecideDeps } from "./decide";
import { UseCaseError } from "./errors";
import {
  approvalExpiry,
  notificationsFor,
  recordDecision,
  type DecisionRecord,
} from "./record-decision";
import { STAGE_LABELS, describeError, type StageFailure } from "./stage";

/**
 * Camino de error: una etapa que falla deja la factura ya registrada en `escalar` con el
 * hallazgo `processing_error`, o en `fallida` si ni eso se puede escribir.
 */

/** Cómo se reintenta una factura fallida: la misma entrega vuelve a procesarse. */
export const RETRY_ACTION = "Vuelve a enviar la misma factura por el mismo canal para reintentarla";

type ErrorData = { readonly stage: StageFailure["stage"]; readonly code: string };

export async function escalateOnFailure(
  deps: DecideDeps,
  args: {
    readonly organization: Organization;
    readonly policyVersion: PolicyVersion;
    readonly invoice: Invoice;
    readonly failure: StageFailure;
    readonly traceId: string;
  },
): Promise<{ readonly invoice: Invoice; readonly decision: Decision }> {
  const { organization, invoice, failure, traceId } = args;
  // La decisión se registra con la política vigente: la del inicio pudo cambiar mientras tanto.
  const policyVersion =
    (await getCurrentPolicy(deps.db, organization.id).catch(() => null)) ?? args.policyVersion;
  const error = describeError(failure.cause);
  const errorData: ErrorData = { stage: failure.stage, code: error.code };
  const telegramLinked = await hasTelegramChat(deps, organization.id);
  const now = deps.now();
  const at = now.toISOString();

  const finding = processingErrorFinding(failure, error);
  const decision = escalationDecision(deps, { invoice, policyVersion, finding, at });
  const record: DecisionRecord = {
    invoice,
    decision,
    duplicateGuard: null,
    patch: { approval_expires_at: approvalExpiry("escalar", now) },
    extraction: null,
    reservation: null,
    events: [
      auditEvent(deps, {
        type: "invoice.escalated",
        invoice,
        decisionId: decision.id,
        data: {
          verdict: "escalar",
          deciding_rule: "processing_error",
          findings: ["processing_error"],
          error: errorData,
          policy_version: policyVersion.version,
          policy_hash: policyVersion.content_hash,
        },
        traceId,
        at,
      }),
    ],
    notifications: notificationsFor({
      decision,
      invoice,
      telegramLinked,
      newId: deps.newId,
      nowIso: at,
    }),
  };

  try {
    await recordDecision(deps.db, record);
  } catch (recordError) {
    await markFailed(deps, { invoice, errorData, traceId, at }, recordError);
    throw new UseCaseError("record_failed", "La factura quedó marcada como fallida", {
      action: RETRY_ACTION,
      retryable: true,
      cause: failure,
    });
  }
  return { invoice: savedInvoice(record), decision };
}

/**
 * El hallazgo que explica el escalado: qué etapa falló y por qué, en palabras ("El PDF tiene
 * 12 páginas y el máximo es 10"). El código del error queda en el mensaje técnico.
 */
function processingErrorFinding(
  failure: StageFailure,
  error: { readonly code: string; readonly message: string },
): Finding {
  return {
    code: "processing_error",
    severity: "block",
    action: "escalar",
    observed: `${STAGE_LABELS[failure.stage]}: ${error.message}`,
    threshold: "un procesamiento completo",
    evidence: null,
    field: null,
    message: `La factura no se pudo procesar por completo (${error.code}): ${error.message}`,
  };
}

/** Una decisión de escalar sin lectura: sin monto, sin beneficiario y sin orden de pago. */
function escalationDecision(
  deps: Pick<DecideDeps, "newId">,
  args: {
    readonly invoice: Invoice;
    readonly policyVersion: PolicyVersion;
    readonly finding: Finding;
    readonly at: string;
  },
): Decision {
  const { invoice, policyVersion, finding } = args;
  return {
    id: deps.newId(),
    organization_id: invoice.organization_id,
    invoice_id: invoice.id,
    verdict: "escalar",
    findings: [finding],
    explanation: explainDecision({
      evaluation: { verdict: "escalar", findings: [finding], log: [], scheduled_for: null },
      amount: null,
      payeeName: null,
      policyVersion: policyVersion.version,
    }),
    summary: null,
    scheduled_for: null,
    payment_order: null,
    amount: null,
    amount_usd: null,
    vendor_id: null,
    policy_version_id: policyVersion.id,
    policy_hash: policyVersion.content_hash,
    document_hash: invoice.document_hash,
    extraction_hash: null,
    field_sources: {},
    previous_decision_id: null,
    dry_run: policyVersion.content.controls.dry_run,
    actor: { kind: "agente" },
    cost_usd_micros: 0,
    latency_ms: 0,
    decided_at: args.at,
  };
}

/**
 * Último recurso: ni la decisión de escalado se pudo escribir. La factura pasa a `fallida`,
 * un estado del que solo se sale reintentando. Si tampoco eso se puede, el error sube.
 */
async function markFailed(
  deps: DecideDeps,
  args: {
    readonly invoice: Invoice;
    readonly errorData: ErrorData;
    readonly traceId: string;
    readonly at: string;
  },
  cause: unknown,
): Promise<void> {
  const { invoice, at } = args;
  try {
    await withWriteTransaction(deps.db, async (tx) => {
      await transitionInvoice(tx, invoice.organization_id, invoice.id, "procesando", "fallida", at);
      await appendEvent(
        tx,
        auditEvent(deps, {
          type: "invoice.failed",
          invoice,
          data: { ...args.errorData, record_error: describeError(cause).code },
          traceId: args.traceId,
          at,
        }),
      );
    });
  } catch (error) {
    throw new UseCaseError("record_failed", "No se pudo registrar el resultado de la factura", {
      action: RETRY_ACTION,
      retryable: true,
      cause: error,
    });
  }
}
