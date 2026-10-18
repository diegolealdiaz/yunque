import { z } from "zod";

import { CurrencySchema, FindingCodeSchema, VerdictSchema } from "@/src/domain";
import { METRIC_KEYS, type Drill } from "@/src/usecases";

/**
 * El número abierto vive en la URL (`?ver=`), así cada tarjeta y cada barra es un enlace
 * que se puede copiar: `autonomia`, `veredicto-frenar`, `grupo-trampa`,
 * `regla-duplicate_invoice`, `moneda-COP`.
 */

const MetricKeySchema = z.enum(METRIC_KEYS);
const CaseGroupSchema = z.enum(["normal", "trampa", "adversarial"]);

export function drillFromParam(param: unknown): Drill | null {
  if (typeof param !== "string" || param.length > 80) return null;
  const metric = MetricKeySchema.safeParse(param);
  if (metric.success) return { kind: "metric", key: metric.data };
  if (param.startsWith("veredicto-")) {
    const verdict = VerdictSchema.safeParse(param.slice("veredicto-".length));
    return verdict.success ? { kind: "verdict", verdict: verdict.data } : null;
  }
  if (param.startsWith("grupo-")) {
    const group = CaseGroupSchema.safeParse(param.slice("grupo-".length));
    return group.success ? { kind: "group", group: group.data } : null;
  }
  if (param.startsWith("regla-")) {
    const code = FindingCodeSchema.safeParse(param.slice("regla-".length));
    return code.success ? { kind: "rule", code: code.data } : null;
  }
  if (param.startsWith("moneda-")) {
    const currency = CurrencySchema.safeParse(param.slice("moneda-".length));
    return currency.success ? { kind: "currency", currency: currency.data } : null;
  }
  return null;
}

/** El valor de `?ver=` de cada número. */
function drillParam(drill: Drill): string {
  switch (drill.kind) {
    case "metric":
      return drill.key;
    case "verdict":
      return `veredicto-${drill.verdict}`;
    case "group":
      return `grupo-${drill.group}`;
    case "rule":
      return `regla-${drill.code}`;
    case "currency":
      return `moneda-${drill.currency}`;
  }
}

/** Enlace a la lista de facturas de un número, en la misma pantalla. */
export function drillHref(drill: Drill): string {
  return `/metricas?ver=${drillParam(drill)}#detalle`;
}
