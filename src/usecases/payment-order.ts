import type { Database } from "@/src/db/client";
import {
  getInvoice,
  getLatestDecision,
  getOrganization,
  getPolicyVersion,
} from "@/src/db/repositories";
import type { Ulid } from "@/src/domain";
import type { PaymentOrderSheet } from "@/src/documents/payment-order";

import { isNotFound } from "./errors";

/**
 * Lo que va en la orden de pago en PDF de una factura, o null si no hay orden: la factura no
 * está pagada, se decidió en modo de prueba (sin orden) o no es de esta empresa. Todo sale
 * de lo que la decisión registró; el texto leído de la factura no se usa.
 */
export async function loadPaymentOrder(
  db: Database,
  organizationId: Ulid,
  invoiceId: Ulid,
  timeZone: string,
): Promise<PaymentOrderSheet | null> {
  const invoice = await getInvoice(db, organizationId, invoiceId).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  if (!invoice) return null;
  const decision = await getLatestDecision(db, organizationId, invoice.id);
  const order = decision?.verdict === "pagar" ? decision.payment_order : null;
  if (!decision || !order) return null;
  const [organization, policy] = await Promise.all([
    getOrganization(db, organizationId),
    getPolicyVersion(db, organizationId, decision.policy_version_id),
  ]);
  return {
    organizationName: organization.name,
    invoiceReference: invoice.reference,
    decisionId: decision.id,
    order,
    decidedAt: decision.decided_at,
    timeZone,
    decidedBy: decision.actor.kind === "humano" ? decision.actor.name : "el agente",
    policyVersion: policy.version,
    policyHash: decision.policy_hash,
    documentHash: decision.document_hash,
  };
}
