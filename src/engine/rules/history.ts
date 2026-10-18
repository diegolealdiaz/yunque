import { onFailOf } from "@/src/domain";

import { wasPaid } from "../context";
import { fail, pass, skipped, type Rule } from "./types";
import { addDays, evidenceOf, fieldsOf, instantOf } from "./shared";

/**
 * Reglas que miran el historial: duplicados, primer pago y frecuencia por beneficiario.
 * La factura que se evalúa se excluye siempre de su propio historial.
 */

export const duplicateInvoice: Rule = {
  code: "duplicate_invoice",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    const action = onFailOf(ctx.policy, "duplicate_invoice");
    const others = ctx.prior.filter((p) => p.invoice_id !== ctx.invoice_id);
    const sameDocument = others.find((p) => p.document_hash === ctx.document_hash);
    if (sameDocument) {
      return fail({
        code: "duplicate_invoice",
        action,
        observed: `el mismo archivo que ${sameDocument.reference ?? sameDocument.invoice_id}`,
        threshold: "un documento no recibido antes",
        field: "invoice_number",
        evidence: evidenceOf(ctx, "invoice_number"),
        message: "Este archivo ya fue recibido antes",
      });
    }
    const { window_days } = ctx.policy.rules.duplicate_invoice;
    const since = addDays(ctx.now, -window_days).getTime();
    const semantic = others.find(
      (p) =>
        p.semantic_key !== null &&
        p.semantic_key === ctx.semantic_key &&
        instantOf(p.received_at) >= since &&
        p.outcome !== "rechazada",
    );
    if (!semantic) return pass;
    return fail({
      code: "duplicate_invoice",
      action,
      observed: `la misma factura que ${semantic.reference ?? semantic.invoice_id}`,
      threshold: `una sola vez en ${String(window_days)} días`,
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
    const paidBefore = ctx.prior.some(
      (p) => p.invoice_id !== ctx.invoice_id && p.vendor_id === vendorId && wasPaid(p),
    );
    if (paidBefore) return pass;
    return fail({
      code: "first_payment_to_vendor",
      action: onFailOf(ctx.policy, "first_payment_to_vendor"),
      observed: "ningún pago previo",
      threshold: "al menos uno",
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
    const since = addDays(ctx.now, -window_days).getTime();
    const recent = ctx.prior.filter(
      (p) =>
        p.invoice_id !== ctx.invoice_id &&
        p.vendor_id === vendorId &&
        instantOf(p.received_at) >= since,
    ).length;
    if (recent < max_invoices) return pass;
    return fail({
      code: "vendor_velocity",
      action: onFailOf(ctx.policy, "vendor_velocity"),
      observed: `${String(recent)} facturas previas en ${String(window_days)} días`,
      threshold: `menos de ${String(max_invoices)}`,
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
