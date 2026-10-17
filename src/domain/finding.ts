import { z } from "zod";

import { EvidenceSchema, ExtractedFieldNameSchema } from "./extraction";
import { FindingCodeSchema, OnFailSchema } from "./rules";

/**
 * Hallazgo: el resultado de evaluar una regla sobre una factura.
 *
 * - `block`: impide pagar. Un solo hallazgo `block` basta para no pagar.
 * - `warn`: no impide pagar, pero aparece en el checklist de aprobación y en la explicación.
 *
 * La acción (`frenar` o `escalar`) sale de la política para esa regla, no del hallazgo.
 * El motor combina severidad y acción para el veredicto final.
 */

export const SeveritySchema = z.enum(["block", "warn"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSchema = z.strictObject({
  code: FindingCodeSchema,
  severity: SeveritySchema,
  /** Acción que la política asigna a esta regla. Las de sistema siempre son `frenar` o `escalar`. */
  action: OnFailSchema,
  /** Lo que se observó, en texto ya formateado para la pantalla: "4.800.000 COP". */
  observed: z.string().max(500),
  /** El umbral o valor esperado, formateado: "≤ 20.000.000 COP". */
  threshold: z.string().max(500),
  /** Cita del documento que respalda el hallazgo, si la hay. */
  evidence: EvidenceSchema.nullable(),
  /** Campo de la extracción al que se refiere, si aplica. */
  field: ExtractedFieldNameSchema.nullable(),
  /** Frase breve para la pantalla y el checklist, en español. */
  message: z.string().min(1).max(500),
});
export type Finding = Readonly<z.infer<typeof FindingSchema>>;

/** Verdadero si algún hallazgo impide pagar. */
export function hasBlocking(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "block");
}

/**
 * El valor observado de `extraction_unreadable` dice si el documento no es una factura o no
 * se pudo leer, seguido del motivo. El motor lo arma y la pantalla lo lee con estas dos
 * funciones: el formato vive en un solo lugar y los hallazgos guardados no cambian.
 */
const UNREADABLE_PREFIX = { not_invoice: "no es una factura", unreadable: "ilegible" } as const;
export type UnreadableKind = keyof typeof UNREADABLE_PREFIX;

export function unreadableObserved(kind: UnreadableKind, reason: string): string {
  return `${UNREADABLE_PREFIX[kind]}: ${reason}`;
}

export function parseUnreadableObserved(observed: string): {
  readonly kind: UnreadableKind;
  readonly reason: string;
} {
  const kind: UnreadableKind = observed.startsWith(UNREADABLE_PREFIX.not_invoice)
    ? "not_invoice"
    : "unreadable";
  const prefix = `${UNREADABLE_PREFIX[kind]}:`;
  const reason = observed.startsWith(prefix) ? observed.slice(prefix.length).trim() : observed;
  return { kind, reason };
}
