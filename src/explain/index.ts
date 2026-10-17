import {
  formatMoney,
  type ChecklistItem,
  type Finding,
  type Money,
  type Verdict,
} from "@/src/domain";
import type { Evaluation } from "@/src/engine";

import { quote } from "./sanitize";
import { checklistItemFor, explainFinding } from "./templates";

export { sanitizeDocumentText, quote } from "./sanitize";
export { TEMPLATES, checklistItemFor, explainFinding, templateCodes } from "./templates";

/**
 * Explicador. Convierte hallazgos en texto para la pantalla y la bitácora. Sin modelo:
 * la explicación es una función determinista de la decisión. Si un modelo redacta un
 * resumen aparte, solo reformula esto y nunca cambia el veredicto.
 */

export type ExplainInput = {
  readonly evaluation: Pick<Evaluation, "verdict" | "findings" | "scheduled_for" | "log">;
  readonly amount: Money | null;
  readonly payeeName: string | null;
  readonly policyVersion: number;
};

const VERDICT_SENTENCE: Record<Verdict, string> = {
  pagar: "Se paga",
  frenar: "Se frena",
  escalar: "Se escala a una persona",
};

/** Explicación completa en prosa breve: veredicto, por qué, y qué pasa después. */
export function explainDecision(input: ExplainInput): string {
  const { evaluation, amount, payeeName, policyVersion } = input;
  const subject = [amount ? formatMoney(amount) : null, payeeName ? `a ${quote(payeeName)}` : null]
    .filter((p): p is string => p !== null)
    .join(" ");
  const head = `${VERDICT_SENTENCE[evaluation.verdict]}${subject ? ` ${subject}` : ""}.`;

  const lines: string[] = [head];
  const failed = evaluation.findings;
  if (failed.length === 0) {
    const passed = evaluation.log.filter((l) => l.outcome === "pass").length;
    lines.push(
      `Las ${String(passed)} reglas aplicables pasaron con la política v${String(policyVersion)}.`,
    );
    if (evaluation.scheduled_for)
      lines.push(`Pago programado para el ${evaluation.scheduled_for}.`);
  } else {
    lines.push(
      `${failed.length === 1 ? "Motivo" : "Motivos"} según la política v${String(policyVersion)}:`,
    );
    for (const finding of failed) lines.push(`- ${finding.code}: ${explainFinding(finding)}`);
    if (evaluation.verdict === "escalar") {
      lines.push("Queda en pendientes hasta que una persona la apruebe, corrija o rechace.");
    } else {
      lines.push("No se paga. Para reconsiderarla hay que corregir la causa y reprocesar.");
    }
  }
  const skipped = evaluation.log.filter((l) => l.outcome === "skipped" && l.detail);
  if (skipped.length > 0 && failed.length > 0) {
    lines.push(`Reglas que no aplicaron: ${skipped.map((l) => l.code).join(", ")}.`);
  }
  return lines.join("\n");
}

/**
 * Checklist de aprobación: una frase por hallazgo que admite confirmación humana, más una
 * general. Sin duplicados por código. Todo sin marcar: la persona marca al revisar.
 */
export function checklistFor(findings: readonly Finding[]): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    const item = checklistItemFor(finding);
    if (item && !seen.has(item.code)) {
      seen.add(item.code);
      items.push(item);
    }
  }
  items.push({
    code: "general",
    text: "Revisé el documento y confirmo beneficiario, monto, moneda y cuenta de destino",
    checked: false,
  });
  return items;
}
