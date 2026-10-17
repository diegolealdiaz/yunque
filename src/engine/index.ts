/**
 * Motor de decisión: reglas puras y el Juez. Sin red, sin base, sin reloj implícito.
 */

export * from "./context";
export * from "./evaluate";
export { RULES_IN_ORDER, assertRegistryComplete, ruleByCode } from "./rules/registry";
export type { Rule, RuleOutcome } from "./rules/types";
export { TOTALS_TOLERANCE } from "./rules/extraction";
