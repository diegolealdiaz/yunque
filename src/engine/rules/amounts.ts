import {
  deviationBasisPoints,
  effectiveHardCapUsdCents,
  formatMoney,
  isPresent,
  money,
  multiplyRatio,
  onFailOf,
  sum,
  toUsd,
  type ExtractedFields,
  type Money,
  type Vendor,
} from "@/src/domain";

import { wasPaid } from "../context";
import { fail, pass, skipped, type Rule } from "./types";
import { amountOf, amountUsdOf, evidenceOf, fieldsOf } from "./shared";

/** Reglas sobre el monto: límites, presupuesto, saldo, acuerdo e historial del beneficiario. */

export const amountOverHardLimit: Rule = {
  code: "amount_over_hard_limit",
  evaluate: (ctx) => {
    const usd = amountUsdOf(ctx);
    if (!usd) return skipped("sin monto en moneda soportada");
    const cap = money(effectiveHardCapUsdCents(ctx.policy), "USD");
    if (usd.amount <= cap.amount) return pass;
    const original = amountOf(ctx);
    return fail({
      code: "amount_over_hard_limit",
      action: "frenar",
      observed: original ? `${formatMoney(original)} (${formatMoney(usd)})` : formatMoney(usd),
      threshold: `≤ ${formatMoney(cap)}`,
      field: "total",
      evidence: evidenceOf(ctx, "total"),
      message: "El monto supera el límite por pago",
    });
  },
};

export const amountOverApprovalThreshold: Rule = {
  code: "amount_over_approval_threshold",
  evaluate: (ctx) => {
    const usd = amountUsdOf(ctx);
    if (!usd) return skipped("sin monto en moneda soportada");
    const threshold = ctx.policy.limits.approval_threshold;
    if (usd.amount <= threshold.amount) return pass;
    const original = amountOf(ctx);
    return fail({
      code: "amount_over_approval_threshold",
      action: "escalar",
      observed: original ? `${formatMoney(original)} (${formatMoney(usd)})` : formatMoney(usd),
      threshold: `≤ ${formatMoney(threshold)}`,
      field: "total",
      evidence: evidenceOf(ctx, "total"),
      message: "El monto supera el umbral que requiere aprobación de una persona",
    });
  },
};

export const budgetExceeded: Rule = {
  code: "budget_exceeded",
  evaluate: (ctx) => {
    const usd = amountUsdOf(ctx);
    if (!usd) return skipped("sin monto en moneda soportada");
    if (!ctx.ledger) {
      return fail({
        code: "ledger_missing",
        action: "frenar",
        observed: "sin libro mayor del periodo",
        threshold: "periodo de presupuesto disponible",
        message: "No existe el registro de presupuesto del periodo; no se puede comprometer",
      });
    }
    const { committed, limit, period_key } = ctx.ledger;
    if (committed + usd.amount <= limit) return pass;
    return fail({
      code: "budget_exceeded",
      action: onFailOf(ctx.policy, "budget_exceeded"),
      observed: `${formatMoney(money(committed, "USD"))} comprometidos + ${formatMoney(usd)}`,
      threshold: `≤ ${formatMoney(money(limit, "USD"))} en ${period_key}`,
      field: "total",
      message: `El pago no cabe en el presupuesto del periodo ${period_key}`,
    });
  },
};

export const insufficientBalance: Rule = {
  code: "insufficient_balance",
  evaluate: (ctx) => {
    const amount = amountOf(ctx);
    if (!amount) return skipped("sin monto en moneda soportada");
    const balance = ctx.balances.find((b) => b.currency === amount.currency);
    const available = balance
      ? money(balance.available, amount.currency)
      : money(0, amount.currency);
    if (available.amount >= amount.amount) return pass;
    return fail({
      code: "insufficient_balance",
      action: "frenar",
      observed: `saldo ${formatMoney(available)}`,
      threshold: `≥ ${formatMoney(amount)}`,
      field: "total",
      message: `El saldo en ${amount.currency} no alcanza para este pago`,
    });
  },
};

/** Monto esperado según el acuerdo del vendor, en la moneda del acuerdo. */
function expectedAmount(
  vendor: Vendor,
  fields: ExtractedFields,
): { expected: Money; basis: string } | { skip: string } {
  const { agreement } = vendor;
  switch (agreement.kind) {
    case "recurring":
      return { expected: agreement.expected, basis: `acuerdo ${formatMoney(agreement.expected)}` };
    case "hourly": {
      const hours = isPresent(fields.hours) ? fields.hours.value : agreement.hours_per_period;
      const expected = multiplyRatio(agreement.rate, hours, 1);
      return {
        expected,
        basis: `${String(hours)} h × ${formatMoney(agreement.rate)}`,
      };
    }
    case "purchase_orders": {
      const open = agreement.orders.filter((o) => o.open);
      if (isPresent(fields.purchase_order)) {
        const wanted = fields.purchase_order.value.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
        const match = open.find(
          (o) => o.number.replace(/[^A-Za-z0-9]+/g, "").toUpperCase() === wanted,
        );
        if (!match) return { skip: `la orden ${fields.purchase_order.value} no está abierta` };
        return { expected: match.amount, basis: `orden ${match.number}` };
      }
      const single = open.length === 1 ? open[0] : undefined;
      if (!single) return { skip: "sin orden de compra en el documento" };
      return { expected: single.amount, basis: `orden ${single.number}` };
    }
    case "none":
      return { skip: "el vendor no tiene acuerdo registrado" };
  }
}

export const amountMismatch: Rule = {
  code: "amount_mismatch",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    const amount = amountOf(ctx);
    if (!fields || !amount) return skipped("sin monto en moneda soportada");
    if (ctx.payee.kind !== "matched") return skipped("beneficiario sin resolver");
    const result = expectedAmount(ctx.payee.vendor, fields);
    if ("skip" in result) return skipped(result.skip);
    const { expected, basis } = result;
    const comparable = expected.currency === amount.currency ? amount : toUsd(amount, ctx.fx);
    const expectedComparable =
      expected.currency === amount.currency ? expected : toUsd(expected, ctx.fx);
    const deviation = deviationBasisPoints(comparable, expectedComparable);
    const { tolerance_bp } = ctx.policy.rules.amount_mismatch;
    if (deviation <= tolerance_bp) return pass;
    return fail({
      code: "amount_mismatch",
      action: onFailOf(ctx.policy, "amount_mismatch"),
      observed: `${formatMoney(amount)} (${(deviation / 100).toFixed(2)} % de diferencia)`,
      threshold: `${basis}, tolerancia ${(tolerance_bp / 100).toFixed(2)} %`,
      field: "total",
      evidence: evidenceOf(ctx, "total"),
      message: "El monto no cuadra con lo acordado con el beneficiario",
    });
  },
};

export const amountUnusualForVendor: Rule = {
  code: "amount_unusual_for_vendor",
  evaluate: (ctx) => {
    const amount = amountOf(ctx);
    if (!amount) return skipped("sin monto en moneda soportada");
    if (ctx.payee.kind !== "matched") return skipped("beneficiario sin resolver");
    const vendorId = ctx.payee.vendor.id;
    const { deviation_bp, min_history } = ctx.policy.rules.amount_unusual_for_vendor;
    const paid = ctx.prior
      .filter((p) => p.vendor_id === vendorId && wasPaid(p) && p.amount !== null)
      .map((p) => p.amount)
      .filter((m): m is Money => m !== null && m.currency === amount.currency);
    if (paid.length < min_history) {
      return skipped(`historial insuficiente: ${String(paid.length)} pagos`);
    }
    const average = multiplyRatio(sum(paid, amount.currency), 1, paid.length);
    const deviation = deviationBasisPoints(amount, average);
    if (deviation <= deviation_bp) return pass;
    return fail({
      code: "amount_unusual_for_vendor",
      action: onFailOf(ctx.policy, "amount_unusual_for_vendor"),
      observed: `${formatMoney(amount)} (${(deviation / 100).toFixed(0)} % frente al promedio)`,
      threshold: `promedio ${formatMoney(average)}, desviación ≤ ${(deviation_bp / 100).toFixed(0)} %`,
      field: "total",
      evidence: evidenceOf(ctx, "total"),
      message: "El monto es atípico frente a los pagos anteriores a este beneficiario",
    });
  },
};

export const AMOUNT_RULES: readonly Rule[] = [
  amountOverHardLimit,
  amountOverApprovalThreshold,
  budgetExceeded,
  insufficientBalance,
  amountMismatch,
  amountUnusualForVendor,
];
