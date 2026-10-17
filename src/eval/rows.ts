import type { CaseDocument, DatasetCase } from "@/src/dataset/schema";
import {
  isPresent,
  normalizeInvoiceNumber,
  normalizeText,
  type Decision,
  type Extraction,
  type ExtractedFields,
} from "@/src/domain";
import { decidingFinding } from "@/src/engine";

import type { EvalRow, FieldComparison } from "./metrics";

/**
 * Cómo se convierte una factura decidida en una fila de métricas. Lo usan `npm run eval` y
 * la pantalla de Métricas: si las dos arman la fila con el mismo código, los números
 * coinciden sobre la misma base (P-91). Puro: no lee archivos ni base.
 */

const alphanumeric = (text: string) => text.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();

/**
 * Campos que se miden y cómo se normalizan antes de comparar. La descripción, texto libre,
 * no se mide.
 */
const MEASURED_FIELDS: readonly {
  readonly name: keyof ExtractedFields & keyof CaseDocument;
  readonly normalize: (value: string | number) => string;
}[] = [
  { name: "payee_name", normalize: (v) => normalizeText(String(v)) },
  { name: "payee_tax_id", normalize: (v) => alphanumeric(String(v)) },
  { name: "invoice_number", normalize: (v) => normalizeInvoiceNumber(String(v)) },
  { name: "issue_date", normalize: String },
  { name: "due_date", normalize: String },
  { name: "currency", normalize: (v) => String(v).toUpperCase() },
  { name: "subtotal", normalize: String },
  { name: "taxes", normalize: String },
  { name: "total", normalize: String },
  { name: "bank_account", normalize: (v) => alphanumeric(String(v)) },
  { name: "bank_holder", normalize: (v) => normalizeText(String(v)) },
  { name: "hours", normalize: String },
  { name: "purchase_order", normalize: (v) => alphanumeric(String(v)) },
];

/** Compara lo leído con lo esperado, campo por campo. Un documento que no es factura no se mide. */
export function compareFields(c: DatasetCase, extraction: Extraction): FieldComparison[] {
  if (c.format === "not_invoice") return [];
  const fields = extraction.kind === "invoice" ? extraction.fields : null;
  return MEASURED_FIELDS.map(({ name, normalize }) => {
    const expected = c.document[name];
    const read = fields?.[name];
    return {
      field: name,
      expected: expected === null ? null : normalize(expected),
      actual: read && isPresent(read) ? normalize(read.value) : null,
    };
  });
}

/** Una decisión se explica si trae explicación y cada hallazgo tiene valor, umbral y mensaje. */
export function isExplained(decision: Decision): boolean {
  return (
    decision.explanation.length > 0 &&
    decision.findings.every((f) => f.observed !== "" && f.threshold !== "" && f.message !== "")
  );
}

/**
 * Fila de un caso del dataset: lo esperado contra lo que decidió el agente. Sin extracción
 * guardada (falló la lectura), cada campo cuenta como no leído.
 */
export function evalRowFor(
  c: DatasetCase,
  decision: Decision,
  extraction: Extraction | null,
  latencyMs: number,
): EvalRow {
  return {
    id: c.id,
    group: c.group,
    expected: { verdict: c.expected.verdict, rule: c.expected.rule },
    actual: { verdict: decision.verdict, rule: decidingFinding(decision)?.code ?? null },
    fields: compareFields(c, extraction ?? { kind: "unreadable", reason: "sin extracción" }),
    explained: isExplained(decision),
    cost_usd_micros: decision.cost_usd_micros,
    latency_ms: latencyMs,
  };
}
