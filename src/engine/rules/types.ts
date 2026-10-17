import type {
  Evidence,
  ExtractedFieldName,
  Finding,
  FindingCode,
  OnFail,
  Severity,
} from "@/src/domain";

import type { EvaluationContext } from "../context";

/**
 * Contrato de una regla: función pura del contexto a un resultado.
 * - `pass`: la regla aplicó y no encontró nada.
 * - `fail`: produce un hallazgo con su acción.
 * - `skipped`: la regla no pudo aplicar (dato ausente, acuerdo sin definir) y lo registra.
 */

export type RuleOutcome =
  | { readonly outcome: "pass" }
  | { readonly outcome: "fail"; readonly finding: Finding }
  | { readonly outcome: "skipped"; readonly reason: string };

export type Rule = {
  readonly code: FindingCode;
  readonly evaluate: (ctx: EvaluationContext) => RuleOutcome;
};

export const pass: RuleOutcome = { outcome: "pass" };

/** La regla no pudo aplicar; el motivo queda en el registro. */
export function skipped(reason: string): RuleOutcome {
  return { outcome: "skipped", reason };
}

export type FindingInput = {
  readonly code: FindingCode;
  readonly action: OnFail;
  readonly observed: string;
  readonly threshold: string;
  readonly message: string;
  readonly severity?: Severity;
  readonly evidence?: Evidence | null;
  readonly field?: ExtractedFieldName | null;
};

/** Construye un hallazgo. Severidad `block` salvo que se indique `warn`. */
export function fail(input: FindingInput): RuleOutcome {
  return {
    outcome: "fail",
    finding: {
      code: input.code,
      severity: input.severity ?? "block",
      action: input.action,
      observed: input.observed,
      threshold: input.threshold,
      evidence: input.evidence ?? null,
      field: input.field ?? null,
      message: input.message,
    },
  };
}
