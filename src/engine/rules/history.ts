import { isPresent, onFailOf } from "@/src/domain";

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

/** Periodo calendario de una fecha ISO según la cadencia del acuerdo: con qué cobro agrupa. */
function periodOf(isoDate: string, period: "month" | "week" | "year"): string {
  if (period === "year") return isoDate.slice(0, 4);
  if (period === "month") return isoDate.slice(0, 7);
  // Semana ISO: año y número de semana, estable entre husos porque la fecha es solo el día.
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const day = (date.getUTCDay() + 6) % 7; // lunes = 0
  date.setUTCDate(date.getUTCDate() - day + 3); // al jueves de esa semana
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / 86_400_000 / 7);
  return `${String(date.getUTCFullYear())}-W${String(week).padStart(2, "0")}`;
}

/**
 * Un proveedor con acuerdo recurrente cobra una vez por periodo (mes, semana o año). Si en el
 * mismo periodo hay otra factura suya, sin rechazar, emitida antes que esta, este segundo cobro
 * escala: una persona confirma que no es un pago doble. La primera del periodo (la de fecha de
 * emisión más temprana) pasa; la posterior escala.
 *
 * El criterio es la fecha de emisión leída, no la de recepción ni el orden de proceso, para que
 * el resultado por factura sea el mismo sin importar en qué orden lleguen, y para que la
 * facturación anticipada del mes siguiente no cuente como repetida. El historial sin fecha de
 * emisión no dispara la regla. A igual fecha, desempata el id de la factura: estable y único.
 */
export const recurringPeriodRepeat: Rule = {
  code: "recurring_period_repeat",
  evaluate: (ctx) => {
    if (ctx.payee.kind !== "matched") return skipped("beneficiario sin resolver");
    const { agreement } = ctx.payee.vendor;
    if (agreement.kind !== "recurring") return skipped("el acuerdo no es recurrente");
    const fields = fieldsOf(ctx);
    if (!fields || !isPresent(fields.issue_date)) return skipped("sin fecha de emisión");
    const issue = fields.issue_date.value;
    const period = periodOf(issue, agreement.period);
    const vendorId = ctx.payee.vendor.id;
    // La «gemela» es una factura del mismo periodo emitida antes (o a la par, con id menor).
    const twin = ctx.prior.find(
      (p) =>
        p.vendor_id === vendorId &&
        p.issue_date !== null &&
        p.outcome !== "rechazada" &&
        periodOf(p.issue_date, agreement.period) === period &&
        (p.issue_date < issue || (p.issue_date === issue && p.invoice_id < ctx.invoice_id)),
    );
    if (!twin) return pass;
    return fail({
      code: "recurring_period_repeat",
      action: onFailOf(ctx.policy, "recurring_period_repeat"),
      observed: `ya hay una factura de ${ctx.payee.vendor.name} del periodo ${period} (${twin.reference ?? twin.invoice_id})`,
      threshold: "un solo cobro por periodo",
      field: "issue_date",
      evidence: evidenceOf(ctx, "issue_date"),
      message: "Este proveedor recurrente ya tiene una factura del mismo periodo",
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
  recurringPeriodRepeat,
  firstPaymentToVendor,
  vendorVelocity,
];
