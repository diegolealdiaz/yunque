import { onFailOf } from "@/src/domain";

import { wasPaid } from "../context";
import { fail, pass, skipped, type Rule } from "./types";
import { addDays, evidenceOf, fieldsOf } from "./shared";

/** Reglas que miran el historial: duplicados, primer pago y frecuencia por beneficiario. */

export const duplicateInvoice: Rule = {
  code: "duplicate_invoice",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    const action = onFailOf(ctx.policy, "duplicate_invoice");
    const sameDocument = ctx.prior.find((p) => p.document_hash === ctx.document_hash);
    if (sameDocument) {
      return fail({
        code: "duplicate_invoice",
        action,
        observed: `mismo archivo que ${sameDocument.invoice_id}`,
        threshold: "documento no recibido antes",
        field: "invoice_number",
        evidence: evidenceOf(ctx, "invoice_number"),
        message: "Este archivo ya fue recibido antes",
      });
    }
    const { window_days } = ctx.policy.rules.duplicate_invoice;
    const since = addDays(ctx.now, -window_days).toISOString();
    const semantic = ctx.prior.find(
      (p) =>
        p.semantic_key !== null &&
        p.semantic_key === ctx.semantic_key &&
        p.received_at >= since &&
        p.outcome !== "rechazada",
    );
    if (!semantic) return pass;
    return fail({
      code: "duplicate_invoice",
      action,
      observed: `misma factura que ${semantic.invoice_id}`,
      threshold: `sin repetición en ${String(window_days)} días`,
      field: "invoice_number",
      evidence: evidenceOf(ctx, "invoice_number"),
      message: "Ya existe una factura del mismo beneficiario con el mismo número y monto",
    });
  },
};

export const firstPaymentToVendor: Rule = {
  code: "first_payment_to_vendor",
  evaluate: (ctx) => {
    if (ctx.payee.kind !== "matched") return skipped("beneficiario sin resolver");
    const vendorId = ctx.payee.vendor.id;
    const paidBefore = ctx.prior.some((p) => p.vendor_id === vendorId && wasPaid(p));
    if (paidBefore) return pass;
    return fail({
      code: "first_payment_to_vendor",
      action: onFailOf(ctx.policy, "first_payment_to_vendor"),
      observed: "sin pagos previos",
      threshold: "al menos un pago anterior",
      field: "payee_name",
      message: `Sería el primer pago a ${ctx.payee.vendor.name}`,
    });
  },
};

export const vendorVelocity: Rule = {
  code: "vendor_velocity",
  evaluate: (ctx) => {
    if (ctx.payee.kind !== "matched") return skipped("beneficiario sin resolver");
    const vendorId = ctx.payee.vendor.id;
    const { max_invoices, window_days } = ctx.policy.rules.vendor_velocity;
    const since = addDays(ctx.now, -window_days).toISOString();
    const recent = ctx.prior.filter(
      (p) => p.vendor_id === vendorId && p.received_at >= since,
    ).length;
    if (recent < max_invoices) return pass;
    return fail({
      code: "vendor_velocity",
      action: onFailOf(ctx.policy, "vendor_velocity"),
      observed: `${String(recent)} facturas previas en ${String(window_days)} días`,
      threshold: `< ${String(max_invoices)}`,
      field: "payee_name",
      message: `${ctx.payee.vendor.name} envió demasiadas facturas en poco tiempo`,
    });
  },
};

export const HISTORY_RULES: readonly Rule[] = [
  duplicateInvoice,
  firstPaymentToVendor,
  vendorVelocity,
];
