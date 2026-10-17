import Link from "next/link";

import { formatMoney, type OnFail } from "@/src/domain";
import { percent } from "@/src/ui/format";
import { RULE_SHORT_LABEL, ruleTitle } from "@/src/ui/labels";
import type { BudgetChart, RuleCount } from "@/src/usecases";

import { drillHref } from "./drill";

/**
 * Los dos gráficos de Métricas (docs/interfaz.md §5.5). Barras hechas con cajas, sin
 * librería: el texto al lado dice lo mismo que el largo, así el gráfico se lee sin color y
 * sin vista. El verde es lo pagado y el rojo y el ámbar son frenar y escalar: los únicos
 * colores de la interfaz siguen siendo los del veredicto.
 */

const frame = "card p-4";
const heading = "caps";

/** Un tono de verde por moneda, del más fuerte al más claro; lo de antes, en gris. */
const SLICE_TONES = [
  "bg-pay",
  "bg-pay-solid",
  "bg-pay-solid/75",
  "bg-pay-solid/55",
  "bg-pay-solid/40",
  "bg-pay-solid/25",
] as const;

function share(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.min(100, (part / whole) * 100);
}

export function BudgetChartCard({ budget }: { readonly budget: BudgetChart }) {
  const limit = budget.limit.amount;
  const tone = (i: number) => SLICE_TONES[Math.min(i, SLICE_TONES.length - 1)];
  return (
    <figure className={frame}>
      <figcaption className={heading}>Pagado contra presupuesto · {budget.periodKey}</figcaption>
      <p className="num mt-2 text-[14px] text-ink">
        {formatMoney(budget.committed)} de {formatMoney(budget.limit)}{" "}
        <span className="text-ink-3">({percent(share(budget.committed.amount, limit) / 100)})</span>
      </p>
      <div
        aria-hidden="true"
        className="mt-3 flex h-3 overflow-hidden rounded-[var(--radius-control)] bg-surface-sunken"
      >
        {budget.byCurrency.map((slice, i) => (
          <span
            key={slice.currency}
            className={`h-full border-r border-surface ${tone(i)}`}
            style={{ width: `${String(share(slice.committed.amount, limit))}%` }}
          />
        ))}
        <span
          className="h-full bg-line-strong"
          style={{ width: `${String(share(budget.earlier.amount, limit))}%` }}
        />
      </div>
      <ul className="mt-3 space-y-1.5 text-[13px]">
        {budget.byCurrency.map((slice, i) => (
          <li key={slice.currency} className="flex items-center justify-between gap-3">
            <Link
              href={drillHref({ kind: "currency", currency: slice.currency })}
              className="inline-flex items-center gap-2 text-ink underline-offset-4 hover:underline"
            >
              <span aria-hidden="true" className={`size-2.5 rounded-sm ${tone(i)}`} />
              Pagado en {slice.currency} · {slice.invoiceIds.length}{" "}
              {slice.invoiceIds.length === 1 ? "factura" : "facturas"}
            </Link>
            <span className="num text-right text-ink-2">
              {formatMoney(slice.paid)}
              {slice.currency === slice.committed.currency ? null : (
                <span className="text-ink-3"> · {formatMoney(slice.committed)}</span>
              )}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 text-ink-2">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-line-strong" />
            Comprometido antes en el periodo
          </span>
          <span className="num">{formatMoney(budget.earlier)}</span>
        </li>
      </ul>
      {budget.byCurrency.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">El agente no ha pagado nada en el periodo.</p>
      ) : null}
    </figure>
  );
}

const ACTION_STYLE: Readonly<Record<OnFail, { bar: string; label: string }>> = {
  frenar: { bar: "bg-hold-solid", label: "frena" },
  escalar: { bar: "bg-escalate-solid", label: "escala" },
};

export function RulesChartCard({
  rules,
  periodKey,
}: {
  readonly rules: readonly RuleCount[];
  readonly periodKey: string;
}) {
  const most = Math.max(1, ...rules.map((r) => r.invoiceIds.length));
  return (
    <figure className={frame}>
      <figcaption className={heading}>Reglas que más dispararon · {periodKey}</figcaption>
      {rules.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">Ninguna regla disparó en el periodo.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {rules.map((rule) => {
            const style = ACTION_STYLE[rule.action];
            const count = rule.invoiceIds.length;
            return (
              <li key={rule.code}>
                <Link
                  href={drillHref({ kind: "rule", code: rule.code })}
                  title={ruleTitle(rule.code)}
                  className="group grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-[13px]"
                >
                  <span className="truncate text-ink group-hover:underline">
                    {RULE_SHORT_LABEL[rule.code]}
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-2.5 overflow-hidden rounded-[var(--radius-control)] bg-surface-sunken"
                  >
                    <span
                      className={`block h-full ${style.bar}`}
                      style={{ width: `${String(share(count, most))}%` }}
                    />
                  </span>
                  <span className="num w-24 text-right text-ink-2">
                    {count} · {style.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </figure>
  );
}
