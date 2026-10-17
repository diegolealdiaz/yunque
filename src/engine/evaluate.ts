import { hasBlocking, isPresent, type Finding, type FindingCode, type Verdict } from "@/src/domain";

import type { EvaluationContext } from "./context";
import { RULES_IN_ORDER, assertRegistryComplete } from "./rules/registry";
import { addDays, fieldsOf, isoDate, parseIsoDate } from "./rules/shared";
import type { RuleOutcome } from "./rules/types";

/**
 * El Juez. Función pura: mismas entradas, mismo resultado, incluido el orden de hallazgos.
 *
 * Veredicto:
 * 1. Cualquier hallazgo con acción `frenar` → frenar.
 * 2. Si no, cualquier hallazgo con acción `escalar` → escalar.
 * 3. Si no, pagar, salvo que los controles lo impidan: con pagos apagados o autonomía
 *    `recomendar`, lo que sería pagar se vuelve escalar con su hallazgo de sistema.
 *
 * Una regla que lanza no tumba la evaluación: produce `rule_error` con acción frenar
 * (invariante 11). Nunca hay un camino que termine en pagar por una excepción.
 */

export type RuleLogEntry = {
  readonly code: FindingCode;
  readonly outcome: RuleOutcome["outcome"] | "error";
  readonly detail: string | null;
};

export type Evaluation = {
  readonly verdict: Verdict;
  /** Hallazgos de las reglas que fallaron, en el orden fijo del registro, más los de sistema al final. */
  readonly findings: readonly Finding[];
  /** Qué hizo cada regla, para la pantalla: falló, pasó, no aplicó o lanzó. */
  readonly log: readonly RuleLogEntry[];
  /** Fecha programada de pago (`YYYY-MM-DD`) solo cuando el veredicto es pagar. */
  readonly scheduled_for: string | null;
};

assertRegistryComplete();

function runRule(rule: (typeof RULES_IN_ORDER)[number], ctx: EvaluationContext): RuleOutcome {
  try {
    return rule.evaluate(ctx);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    return {
      outcome: "fail",
      finding: {
        code: "rule_error",
        severity: "block",
        action: "frenar",
        observed: `${rule.code}: ${detail}`,
        threshold: "evaluación sin errores",
        evidence: null,
        field: null,
        message: `La regla ${rule.code} no pudo evaluarse; se frena por seguridad`,
      },
    };
  }
}

/**
 * Fecha programada: `due_date - schedule_days_before`, nunca antes de hoy. Sin fecha de
 * vencimiento, hoy.
 */
export function scheduleFor(ctx: EvaluationContext): string {
  const fields = fieldsOf(ctx);
  const today = isoDate(ctx.now);
  if (!fields || !isPresent(fields.due_date)) return today;
  const { schedule_days_before } = ctx.policy.rules.due_date_window;
  const target = addDays(parseIsoDate(fields.due_date.value), -schedule_days_before);
  const targetIso = isoDate(target);
  return targetIso < today ? today : targetIso;
}

function verdictFrom(findings: readonly Finding[]): Verdict {
  if (findings.some((f) => f.severity === "block" && f.action === "frenar")) return "frenar";
  if (findings.some((f) => f.severity === "block" && f.action === "escalar")) return "escalar";
  return "pagar";
}

/** Evalúa la factura contra la política y devuelve veredicto, hallazgos, registro y fecha. */
export function evaluate(ctx: EvaluationContext): Evaluation {
  const findings: Finding[] = [];
  const log: RuleLogEntry[] = [];
  const readable = ctx.extraction.kind === "invoice";

  for (const rule of RULES_IN_ORDER) {
    // Si no se entendió la factura, solo corren las reglas de lectura; el resto no aplica.
    const result =
      readable || rule.code === "extraction_unreadable" || rule.code === "suspicious_instructions"
        ? runRule(rule, ctx)
        : { outcome: "skipped" as const, reason: "sin lectura" };
    if (result.outcome === "fail") {
      findings.push(result.finding);
      log.push({
        code: rule.code,
        outcome: result.finding.code === "rule_error" ? "error" : "fail",
        detail: result.finding.message,
      });
    } else if (result.outcome === "skipped") {
      log.push({ code: rule.code, outcome: "skipped", detail: result.reason });
    } else {
      log.push({ code: rule.code, outcome: "pass", detail: null });
    }
  }

  let verdict = verdictFrom(findings);

  if (verdict === "pagar" && !ctx.policy.controls.payments_enabled) {
    findings.push({
      code: "payments_disabled",
      severity: "block",
      action: "escalar",
      observed: "apagados",
      threshold: "encendidos",
      evidence: null,
      field: null,
      message: "Los pagos están apagados; la factura queda para una persona",
    });
    verdict = "escalar";
  }

  if (verdict === "pagar" && ctx.policy.controls.autonomy === "recomendar") {
    findings.push({
      code: "autonomy_recomendar",
      severity: "block",
      action: "escalar",
      observed: "recomendar",
      threshold: "decidir",
      evidence: null,
      field: null,
      message:
        "La empresa pidió que toda decisión pase por una persona; el agente recomienda pagar",
    });
    verdict = "escalar";
  }

  if (verdict === "pagar" && hasBlocking(findings)) {
    // Defensa en profundidad: no debería ocurrir, pero nunca se paga con un hallazgo block.
    verdict = "frenar";
  }

  return {
    verdict,
    findings,
    log,
    scheduled_for: verdict === "pagar" ? scheduleFor(ctx) : null,
  };
}
