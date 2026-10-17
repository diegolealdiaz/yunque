import { RULE_CODES, type RuleCode } from "@/src/domain";

import { AMOUNT_RULES } from "./amounts";
import { DATE_RULES } from "./dates";
import { EXTRACTION_RULES } from "./extraction";
import { HISTORY_RULES } from "./history";
import { PAYEE_RULES } from "./payee";
import type { Rule } from "./types";

/**
 * Registro central de reglas, en el orden en que se evalúan: primero la lectura (si no se
 * entendió, lo demás no aplica), luego beneficiario y cuenta, montos, historial y fechas.
 * El orden es fijo para que el resultado sea reproducible (invariante 7).
 */
export const RULES_IN_ORDER: readonly Rule[] = [
  ...EXTRACTION_RULES,
  ...PAYEE_RULES,
  ...AMOUNT_RULES,
  ...HISTORY_RULES,
  ...DATE_RULES,
];

const byCode = new Map<string, Rule>(RULES_IN_ORDER.map((r) => [r.code, r]));

/** Lanza si el catálogo del dominio y el código no coinciden uno a uno. */
export function assertRegistryComplete(): void {
  const missing = RULE_CODES.filter((code) => !byCode.has(code));
  const extra = RULES_IN_ORDER.map((r) => r.code).filter(
    (code) => !RULE_CODES.some((known) => known === code),
  );
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Registro de reglas incompleto. Faltan: [${missing.join(", ")}]. Sobran: [${extra.join(", ")}]`,
    );
  }
  if (byCode.size !== RULES_IN_ORDER.length) {
    throw new Error("Hay reglas con código repetido en el registro");
  }
}

/** Regla por código; lanza si no existe en el código. */
export function ruleByCode(code: RuleCode): Rule {
  const rule = byCode.get(code);
  if (!rule) throw new Error(`La regla ${code} no existe en el código`);
  return rule;
}
