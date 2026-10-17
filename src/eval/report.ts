import { PROMPT_VERSION } from "@/src/extraction";

import type { GateResult } from "./gate";
import type { Ratio } from "./metrics";
import type { EvaluationResult } from "./run";

/**
 * Informe de consola del set de regresión, en el orden de `trazabilidad.md` §3: seguridad,
 * autonomía, explicabilidad, exactitud, y después costo y latencia. Texto plano, apto para
 * la salida de CI.
 */

const percent = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 });

function share(r: Ratio): string {
  return `${String(r.hits)}/${String(r.total)} (${percent.format(r.rate)})`;
}

const SOURCE_LABEL: Record<EvaluationResult["source"], string> = {
  fixtures: "respuestas grabadas del modelo",
  live: "modelo en vivo (grabando fixtures)",
  ideal: "Lector ideal derivado del manifiesto (no mide al modelo)",
};

export function formatReport(result: EvaluationResult, gate: GateResult): string {
  const m = result.metrics;
  const lines: string[] = [];
  const rule = "─".repeat(64);
  lines.push("Yunque · set de regresión", rule);
  lines.push(`Fuente del Lector   ${SOURCE_LABEL[result.source]}`);
  lines.push(`Prompt              ${PROMPT_VERSION}`);
  lines.push(
    `Modelos             ${result.models.primary}${result.models.fallback ? ` · respaldo ${result.models.fallback}` : ""}`,
  );
  lines.push(`Facturas            ${String(m.total)}`, "");

  lines.push(
    `Seguridad           falsos pagar: ${String(m.false_pay.length)}${m.false_pay.length > 0 ? ` (${m.false_pay.join(", ")})` : ""}`,
  );
  lines.push(`Autonomía           ${share(m.autonomy)}`);
  lines.push(
    `  por grupo         normales ${share(m.by_group.normal)} · trampa ${share(m.by_group.trampa)} · adversariales ${share(m.by_group.adversarial)}`,
  );
  lines.push(`Regla esperada      ${share(m.rule_match)}`);
  lines.push(
    `Escalado            ${share(m.escalation)} · sobre normales ${share(m.escalation_on_normals)}`,
  );
  lines.push(`Explicabilidad      ${share(m.explainability)}`, "");

  lines.push("Exactitud por campo");
  for (const [field, r] of Object.entries(m.field_accuracy)) {
    lines.push(`  ${field.padEnd(18)}${share(r)}`);
  }
  lines.push("");

  lines.push("Matriz de confusión (esperado → obtenido)");
  lines.push(
    `  ${"".padEnd(10)}${["pagar", "frenar", "escalar"].map((v) => v.padStart(9)).join("")}`,
  );
  for (const expected of ["pagar", "frenar", "escalar"] as const) {
    const row = m.confusion[expected];
    lines.push(
      `  ${expected.padEnd(10)}${[row.pagar, row.frenar, row.escalar].map((n) => String(n).padStart(9)).join("")}`,
    );
  }
  lines.push("");

  lines.push(
    `Costo               total ${usd.format(m.cost.total_usd_micros / 1_000_000)} USD · por factura ${usd.format(m.cost.per_invoice_usd_micros / 1_000_000)} USD`,
  );
  lines.push(
    `Latencia            media ${String(m.latency.mean_ms)} ms · máxima ${String(m.latency.max_ms)} ms`,
  );

  const misses = result.rows.filter(
    (r) => r.actual.verdict !== r.expected.verdict || r.actual.rule !== r.expected.rule,
  );
  if (misses.length > 0) {
    lines.push("", "Casos que no coinciden");
    for (const r of misses) {
      lines.push(
        `  ${r.id.padEnd(22)}esperado ${r.expected.verdict}/${r.expected.rule ?? "-"} · obtenido ${r.actual.verdict}/${r.actual.rule ?? "-"}`,
      );
    }
  }
  if (result.missing_fixtures.length > 0) {
    lines.push("", `Peticiones sin fixture: ${String(result.missing_fixtures.length)}`);
  }

  lines.push("", rule, gate.passed ? "Puerta: APROBADA" : "Puerta: RECHAZADA");
  for (const failure of gate.failures) lines.push(`  - ${failure}`);
  return lines.join("\n");
}
