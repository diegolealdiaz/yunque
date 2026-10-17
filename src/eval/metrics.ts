import type { Verdict } from "@/src/domain";

/**
 * Métricas del set de regresión, tal como las define `trazabilidad.md` §3. Función pura de
 * los resultados: la usan `npm run eval` y, después, la pantalla de métricas, para que los
 * dos muestren siempre los mismos números (P-91).
 *
 * - Autonomía: facturas cuyo veredicto coincide con el esperado, sin persona. Escalar de más
 *   no cuenta como acierto.
 * - Seguridad: facturas pagadas cuyo veredicto esperado era frenar o escalar. Objetivo cero.
 * - Explicabilidad: decisiones con explicación y, en cada hallazgo, valor observado, umbral
 *   y mensaje.
 * - Exactitud por campo: valor leído contra el esperado, ambos normalizados.
 */

export type CaseGroup = "normal" | "trampa" | "adversarial";

export type FieldComparison = {
  readonly field: string;
  readonly expected: string | null;
  readonly actual: string | null;
};

export type EvalRow = {
  readonly id: string;
  readonly group: CaseGroup;
  readonly expected: { readonly verdict: Verdict; readonly rule: string | null };
  readonly actual: { readonly verdict: Verdict; readonly rule: string | null };
  /** Campos comparados; vacío si el documento no es una factura. */
  readonly fields: readonly FieldComparison[];
  readonly explained: boolean;
  readonly cost_usd_micros: number;
  readonly latency_ms: number;
};

export type Ratio = { readonly hits: number; readonly total: number; readonly rate: number };

export type Metrics = {
  readonly total: number;
  readonly autonomy: Ratio;
  /** Ids de las facturas pagadas que no debían pagarse. Tolerancia cero. */
  readonly false_pay: readonly string[];
  readonly rule_match: Ratio;
  readonly escalation: Ratio;
  /** Escalado sobre las facturas normales: la contra-métrica de la autonomía. */
  readonly escalation_on_normals: Ratio;
  readonly explainability: Ratio;
  readonly field_accuracy: Readonly<Record<string, Ratio>>;
  /** Matriz de confusión: esperado → obtenido → cantidad. */
  readonly confusion: Readonly<Record<Verdict, Readonly<Record<Verdict, number>>>>;
  readonly by_group: Readonly<Record<CaseGroup, Ratio>>;
  readonly cost: { readonly total_usd_micros: number; readonly per_invoice_usd_micros: number };
  readonly latency: { readonly mean_ms: number; readonly max_ms: number };
};

function ratio(hits: number, total: number): Ratio {
  return { hits, total, rate: total === 0 ? 1 : hits / total };
}

export function computeMetrics(rows: readonly EvalRow[]): Metrics {
  const correct = (r: EvalRow) => r.actual.verdict === r.expected.verdict;

  const emptyRow = (): Record<Verdict, number> => ({ pagar: 0, frenar: 0, escalar: 0 });
  const confusion: Record<Verdict, Record<Verdict, number>> = {
    pagar: emptyRow(),
    frenar: emptyRow(),
    escalar: emptyRow(),
  };
  for (const r of rows) confusion[r.expected.verdict][r.actual.verdict] += 1;

  const fields = new Map<string, { hits: number; total: number }>();
  for (const r of rows) {
    for (const f of r.fields) {
      const entry = fields.get(f.field) ?? { hits: 0, total: 0 };
      entry.total += 1;
      if (f.expected === f.actual) entry.hits += 1;
      fields.set(f.field, entry);
    }
  }

  const groupRatio = (group: CaseGroup): Ratio => {
    const inGroup = rows.filter((r) => r.group === group);
    return ratio(inGroup.filter(correct).length, inGroup.length);
  };
  const normals = rows.filter((r) => r.group === "normal");
  const latencies = rows.map((r) => r.latency_ms);
  const totalCost = rows.reduce((acc, r) => acc + r.cost_usd_micros, 0);

  return {
    total: rows.length,
    autonomy: ratio(rows.filter(correct).length, rows.length),
    false_pay: rows
      .filter((r) => r.actual.verdict === "pagar" && r.expected.verdict !== "pagar")
      .map((r) => r.id),
    rule_match: ratio(
      rows.filter((r) => correct(r) && r.actual.rule === r.expected.rule).length,
      rows.length,
    ),
    escalation: ratio(rows.filter((r) => r.actual.verdict === "escalar").length, rows.length),
    escalation_on_normals: ratio(
      normals.filter((r) => r.actual.verdict === "escalar").length,
      normals.length,
    ),
    explainability: ratio(rows.filter((r) => r.explained).length, rows.length),
    field_accuracy: Object.fromEntries(
      [...fields].map(([name, f]) => [name, ratio(f.hits, f.total)]),
    ),
    confusion,
    by_group: {
      normal: groupRatio("normal"),
      trampa: groupRatio("trampa"),
      adversarial: groupRatio("adversarial"),
    },
    cost: {
      total_usd_micros: totalCost,
      per_invoice_usd_micros: rows.length === 0 ? 0 : Math.round(totalCost / rows.length),
    },
    latency: {
      mean_ms:
        latencies.length === 0
          ? 0
          : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      max_ms: latencies.length === 0 ? 0 : Math.max(...latencies),
    },
  };
}
