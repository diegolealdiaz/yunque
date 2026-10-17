import { z } from "zod";

import { CurrencySchema, FindingCodeSchema } from "@/src/domain";
import { METRIC_KEYS, type Drill } from "@/src/usecases";

/**
 * El número abierto vive en la URL (`?ver=`), así cada tarjeta y cada barra es un enlace
 * que se puede copiar: `autonomia`, `regla-duplicate_invoice`, `moneda-COP`.
 */

const MetricKeySchema = z.enum(METRIC_KEYS);

export function drillFromParam(param: unknown): Drill | null {
  if (typeof param !== "string" || param.length > 80) return null;
  const metric = MetricKeySchema.safeParse(param);
  if (metric.success) return { kind: "metric", key: metric.data };
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

/** Enlace a la lista de facturas de un número, en la misma pantalla. */
export function drillHref(drill: Drill): string {
  const param =
    drill.kind === "metric"
      ? drill.key
      : drill.kind === "rule"
        ? `regla-${drill.code}`
        : `moneda-${drill.currency}`;
  return `/metricas?ver=${param}#detalle`;
}
