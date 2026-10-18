import type { ReactNode } from "react";

import { formatMoney, isSupportedCurrency, money } from "@/src/domain";
import { calendarDate } from "@/src/ui/format";
import type { DetailField } from "@/src/usecases";

/** Piezas que comparten las columnas del detalle de una factura. */

export const MONEY_FIELDS: ReadonlySet<string> = new Set(["subtotal", "taxes", "total"]);
export const DATE_FIELDS: ReadonlySet<string> = new Set(["issue_date", "due_date"]);

/** Valor de un campo para la pantalla: montos con su moneda, fechas absolutas. */
export function displayValue(field: DetailField, currency: string | null): string {
  if (
    typeof field.value === "number" &&
    MONEY_FIELDS.has(field.name) &&
    currency &&
    isSupportedCurrency(currency)
  ) {
    return formatMoney(money(field.value, currency));
  }
  if (typeof field.value === "string" && DATE_FIELDS.has(field.name))
    return calendarDate(field.value);
  return String(field.value);
}

export function SubTitle({ children }: { readonly children: ReactNode }) {
  return <h3 className="caps">{children}</h3>;
}
