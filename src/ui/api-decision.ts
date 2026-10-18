import {
  decimalText,
  type Decision,
  type FindingCode,
  type Invoice,
  type InvoiceStatus,
  type Money,
  type OnFail,
  type Severity,
  type Verdict,
} from "@/src/domain";

import { decisionSummary, reasonFor, type DecisionSummary } from "./reasons";

/**
 * La respuesta de la API de decisión (D32) para el agente que preguntó. Las claves van en
 * inglés; los valores del dominio (`pagar`, `frenar`, `escalar`, estados) y las frases para
 * personas, en español, las mismas que muestra la pantalla. Determinista: sale de lo que la
 * decisión ya registró.
 */

export type ApiAmount = {
  /** Decimal con punto, como en la solicitud: "1200.00". */
  readonly value: string;
  readonly currency: Money["currency"];
};

export type ApiFinding = {
  readonly code: FindingCode;
  readonly severity: Severity;
  readonly action: OnFail;
  readonly title: string;
  readonly detail: string;
};

export type ApiDecisionBody = {
  readonly reference: string;
  readonly status: InvoiceStatus;
  /** Null mientras se procesa. */
  readonly verdict: Verdict | null;
  /** `agente`, o el nombre de quien aprobó o rechazó. */
  readonly decided_by: string | null;
  /** La regla que decidió; null si se pagó dentro de las reglas. */
  readonly deciding_rule: FindingCode | null;
  readonly headline: string;
  readonly next_step: string;
  readonly findings: readonly ApiFinding[];
  readonly amount: ApiAmount | null;
  readonly scheduled_for: string | null;
  /** Orden preparada de un `pagar`, con la cuenta del beneficiario registrado. Nunca se ejecuta. */
  readonly payment_order: {
    readonly status: "preparada_no_ejecutada";
    readonly beneficiary: string;
    readonly account: string;
    readonly rail: string;
    readonly amount: ApiAmount;
    readonly scheduled_for: string;
  } | null;
  /** Modo de prueba: se decide y registra sin preparar órdenes. */
  readonly dry_run: boolean;
  /** La misma solicitud ya se había recibido: esta es su decisión, no una nueva. */
  readonly replayed: boolean;
  /** El acta en la pantalla de Yunque; null sin URL pública configurada. */
  readonly record_url: string | null;
};

function apiAmount(m: Money): ApiAmount {
  return { value: decimalText(m.amount, m.currency), currency: m.currency };
}

/**
 * Lo que el agente lee primero. La pantalla dice «Se pagó» porque ahí la orden queda
 * preparada; un agente externo lo leería como que ya se pagó y no pagaría, o pagaría dos
 * veces. Aquí se dice qué puede hacer él: Yunque decide y prepara la orden, no la ejecuta.
 */
function apiSummary(status: InvoiceStatus, decision: Decision | null): DecisionSummary {
  if (decision === null) return decisionSummary("escalar", status);
  if (decision.verdict === "pagar" && (status === "decidida" || status === "aprobada")) {
    return {
      headline:
        status === "aprobada"
          ? "Una persona la aprobó: se puede pagar."
          : "Cumple tus reglas: se puede pagar.",
      next: "Yunque preparó la orden de pago y no la ejecuta: págala una sola vez.",
    };
  }
  return decisionSummary(decision.verdict, status, decision.findings);
}

export function apiDecisionBody(input: {
  readonly invoice: Invoice;
  readonly decision: Decision | null;
  /** La regla que decidió, según el motor (`decidingFinding`). */
  readonly decidingRule: FindingCode | null;
  readonly replayed: boolean;
  readonly appUrl: string | null;
}): ApiDecisionBody {
  const { invoice, decision } = input;
  const findings = decision?.findings ?? [];
  const summary = apiSummary(invoice.status, decision);
  const order = decision?.payment_order ?? null;
  return {
    reference: invoice.reference,
    status: invoice.status,
    verdict: decision?.verdict ?? null,
    decided_by: decision
      ? decision.actor.kind === "humano"
        ? decision.actor.name
        : "agente"
      : null,
    deciding_rule: input.decidingRule,
    headline: summary.headline,
    next_step: summary.next,
    findings: findings.map((f) => ({
      code: f.code,
      severity: f.severity,
      action: f.action,
      ...reasonFor(f),
    })),
    amount: decision?.amount ? apiAmount(decision.amount) : null,
    scheduled_for: decision?.scheduled_for ?? null,
    payment_order: order
      ? {
          status: order.status,
          beneficiary: order.beneficiary_name,
          account: order.account_masked,
          rail: order.rail,
          amount: apiAmount(order.amount),
          scheduled_for: order.scheduled_for,
        }
      : null,
    dry_run: decision?.dry_run ?? false,
    replayed: input.replayed,
    record_url: input.appUrl ? `${input.appUrl}/facturas/${invoice.id}` : null,
  };
}
