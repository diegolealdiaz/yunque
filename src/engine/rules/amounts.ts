import {
  deviationBasisPoints,
  effectiveHardCapUsdCents,
  exceedsUsd,
  formatMoney,
  isPresent,
  money,
  multiplyRatio,
  onFailOf,
  periodKey,
  sum,
  toUsd,
  type ExtractedFields,
  type Money,
  type Vendor,
} from "@/src/domain";

import { wasPaid } from "../context";
import { fail, pass, skipped, type Rule } from "./types";
import { amountOf, amountUsdOf, evidenceOf, fieldsOf } from "./shared";

/**
 * Reglas sobre el monto: límites, presupuesto, saldo, acuerdo e historial del beneficiario.
 * Los límites en USD se comparan sin redondear (`exceedsUsd`): medio centavo por encima
 * del límite ya es por encima.
 */

function observedAmount(ctx: Parameters<Rule["evaluate"]>[0]): string {
  const original = amountOf(ctx);
  const usd = amountUsdOf(ctx);
  if (!original) return "sin monto";
  return original.currency === "USD" || !usd
    ? formatMoney(original)
    : `${formatMoney(original)} (≈ ${formatMoney(usd)})`;
}

export const amountOverHardLimit: Rule = {
  code: "amount_over_hard_limit",
  evaluate: (ctx) => {
    const amount = amountOf(ctx);
    if (!amount) return skipped("sin monto en moneda soportada");
    const capCents = effectiveHardCapUsdCents(ctx.policy);
    if (!exceedsUsd(amount, capCents, ctx.fx)) return pass;
    return fail({
      code: "amount_over_hard_limit",
      action: "frenar",
      observed: observedAmount(ctx),
      threshold: formatMoney(money(capCents, "USD")),
      field: "total",
      evidence: evidenceOf(ctx, "total"),
      message: "El monto supera el límite por pago",
    });
  },
};

export const amountOverApprovalThreshold: Rule = {
  code: "amount_over_approval_threshold",
  evaluate: (ctx) => {
    const amount = amountOf(ctx);
    if (!amount) return skipped("sin monto en moneda soportada");
    const threshold = ctx.policy.limits.approval_threshold;
    if (!exceedsUsd(amount, threshold.amount, ctx.fx)) return pass;
    return fail({
      code: "amount_over_approval_threshold",
      action: "escalar",
      observed: observedAmount(ctx),
      threshold: formatMoney(threshold),
      field: "total",
      evidence: evidenceOf(ctx, "total"),
      message: "El monto supera el umbral que requiere aprobación de una persona",
    });
  },
};

/**
 * Presupuesto del periodo. El ledger debe ser el del periodo y la moneda de la política;
 * si falta o no corresponde, es un artefacto ausente y se frena (invariante 11).
 */
export const budgetExceeded: Rule = {
  code: "budget_exceeded",
  evaluate: (ctx) => {
    const amount = amountOf(ctx);
    if (!amount) return skipped("sin monto en moneda soportada");
    const { budget } = ctx.policy.limits;
    const expectedKey = periodKey(ctx.now, budget.period);
    const ledger = ctx.ledger;
    if (!ledger || ledger.currency !== budget.currency || ledger.period_key !== expectedKey) {
      return fail({
        code: "ledger_missing",
        action: "frenar",
        observed: ledger ? `${ledger.period_key} en ${ledger.currency}` : "ninguno",
        threshold: `${expectedKey} en ${budget.currency}`,
        message: "No existe el registro de presupuesto del periodo; no se puede comprometer",
      });
    }
    const remaining = ledger.limit - ledger.committed;
    if (remaining >= 0 && !exceedsUsd(amount, remaining, ctx.fx)) return pass;
    return fail({
      code: "budget_exceeded",
      action: onFailOf(ctx.policy, "budget_exceeded"),
      observed: `${observedAmount(ctx)} con ${formatMoney(money(ledger.committed, "USD"))} ya comprometidos`,
      threshold: `${formatMoney(money(ledger.limit, "USD"))} en ${ledger.period_key}`,
      field: "total",
      message: `El pago no cabe en el presupuesto del periodo ${ledger.period_key}`,
    });
  },
};

export const insufficientBalance: Rule = {
  code: "insufficient_balance",
  evaluate: (ctx) => {
    const amount = amountOf(ctx);
    if (!amount) return skipped("sin monto en moneda soportada");
    const balance = ctx.balances.find((b) => b.currency === amount.currency);
    if (balance && balance.available >= amount.amount) return pass;
    return fail({
      code: "insufficient_balance",
      action: "frenar",
      observed: balance
        ? formatMoney(money(balance.available, amount.currency))
        : "sin saldo registrado",
      threshold: formatMoney(amount),
      field: "total",
      message: `El saldo en ${amount.currency} no alcanza para este pago`,
    });
  },
};

const normalizeOrderNumber = (text: string) => text.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();

/**
 * Monto esperado según el acuerdo del vendor, en la moneda del acuerdo. Las horas acordadas
 * son la vara de medir; las horas que trae el documento nunca la reemplazan.
 */
function expectedAmount(
  vendor: Vendor,
  fields: ExtractedFields,
):
  | { expected: Money; basis: string }
  | { skip: string }
  | { fail: { observed: string; threshold: string } } {
  const { agreement } = vendor;
  switch (agreement.kind) {
    case "recurring":
      return { expected: agreement.expected, basis: formatMoney(agreement.expected) };
    case "hourly": {
      const agreed = agreement.hours_per_period;
      if (isPresent(fields.hours) && fields.hours.value > agreed) {
        return {
          fail: {
            observed: `${String(fields.hours.value)} h reportadas`,
            threshold: `${String(agreed)} h acordadas`,
          },
        };
      }
      const hours = isPresent(fields.hours) ? fields.hours.value : agreed;
      return {
        expected: multiplyRatio(agreement.rate, hours, 1),
        basis: `${String(hours)} h × ${formatMoney(agreement.rate)}`,
      };
    }
    case "purchase_orders": {
      const open = agreement.orders.filter((o) => o.open);
      if (isPresent(fields.purchase_order)) {
        const wanted = normalizeOrderNumber(fields.purchase_order.value);
        const match = open.find((o) => normalizeOrderNumber(o.number) === wanted);
        if (!match) {
          return {
            fail: {
              observed: `orden ${fields.purchase_order.value}`,
              threshold:
                open.length > 0
                  ? `órdenes abiertas ${open.map((o) => o.number).join(", ")}`
                  : "sin órdenes abiertas",
            },
          };
        }
        return { expected: match.amount, basis: `orden ${match.number}` };
      }
      if (open.length === 1 && open[0]) {
        return { expected: open[0].amount, basis: `orden ${open[0].number}` };
      }
      return {
        skip:
          open.length === 0
            ? "sin órdenes de compra abiertas"
            : "varias órdenes abiertas y el documento no indica cuál",
      };
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
    const action = onFailOf(ctx.policy, "amount_mismatch");
    const result = expectedAmount(ctx.payee.vendor, fields);
    if ("skip" in result) return skipped(result.skip);
    if ("fail" in result) {
      return fail({
        code: "amount_mismatch",
        action,
        observed: result.fail.observed,
        threshold: result.fail.threshold,
        field: "total",
        evidence: evidenceOf(ctx, "total"),
        message: "La factura no cuadra con lo acordado con el beneficiario",
      });
    }
    const { expected, basis } = result;
    const sameCurrency = expected.currency === amount.currency;
    const actual = sameCurrency ? amount : toUsd(amount, ctx.fx);
    const reference = sameCurrency ? expected : toUsd(expected, ctx.fx);
    const deviation = deviationBasisPoints(actual, reference);
    const { tolerance_bp } = ctx.policy.rules.amount_mismatch;
    if (deviation <= tolerance_bp) return pass;
    return fail({
      code: "amount_mismatch",
      action,
      observed: `${formatMoney(amount)}, ${(deviation / 100).toFixed(2)} % de diferencia`,
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
      observed: `${formatMoney(amount)}, ${(deviation / 100).toFixed(0)} % frente al promedio`,
      threshold: `promedio ${formatMoney(average)}, desviación hasta ${(deviation_bp / 100).toFixed(0)} %`,
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
