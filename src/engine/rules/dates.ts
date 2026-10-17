import { isPresent, onFailOf } from "@/src/domain";

import { fail, pass, skipped, type Rule } from "./types";
import { daysBetween, fieldsOf, parseIsoDate } from "./shared";

/**
 * Fecha de vencimiento. Solo dispara si la factura está vencida más allá del atraso máximo.
 * La fecha programada de pago la calcula `scheduleFor` en el Juez, no esta regla.
 */
export const dueDateWindow: Rule = {
  code: "due_date_window",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    if (!isPresent(fields.due_date)) return skipped("sin fecha de vencimiento; se programa hoy");
    const { max_days_overdue } = ctx.policy.rules.due_date_window;
    const overdue = daysBetween(parseIsoDate(fields.due_date.value), ctx.now);
    if (overdue <= max_days_overdue) return pass;
    return fail({
      code: "due_date_window",
      action: onFailOf(ctx.policy, "due_date_window"),
      observed: `vencida hace ${String(overdue)} días`,
      threshold: `atraso ≤ ${String(max_days_overdue)} días`,
      field: "due_date",
      evidence: fields.due_date.evidence,
      message: "La factura está vencida desde hace demasiado tiempo para pagarla sin revisar",
    });
  },
};

export const DATE_RULES: readonly Rule[] = [dueDateWindow];
