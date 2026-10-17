import type { Evidence, Extraction } from "@/src/domain";

import { fieldLiteral, formatAmount } from "./format";
import type { DatasetCase, DocumentTemplate } from "./schema";

/**
 * Lectura ideal de un caso: lo que devolvería un Lector perfecto, derivado de la verdad del
 * manifiesto con las mismas cadenas literales que se pintan en el documento. Sirve para
 * probar el resto del sistema sin modelo y como referencia de `npm run eval` en modo ideal.
 * No mide al modelo: mide todo lo que viene después de él.
 */
export function idealExtraction(c: DatasetCase, template: DocumentTemplate): Extraction {
  if (c.format === "not_invoice") {
    return { kind: "not_invoice", reason: "comprobante de nómina, no una factura", suspicions: [] };
  }
  const doc = c.document;
  const ev = (literal: string): Evidence => ({ literal, quote: literal, page: 1 });
  const present = <T>(value: T, literal: string) => ({
    value,
    evidence: ev(literal),
    confidence: 0.96,
    source: "modelo" as const,
  });
  const missing = { value: null, reason: "no aparece en el documento" };
  const lit = (name: Parameters<typeof fieldLiteral>[1]) =>
    fieldLiteral(doc, name, template.locale);
  const amountField = (value: number | null) =>
    value === null ? missing : present(value, formatAmount(value, template.locale));
  return {
    kind: "invoice",
    language: template.locale.startsWith("en")
      ? "en"
      : template.locale.startsWith("de")
        ? "de"
        : "es",
    fields: {
      payee_name: present(doc.payee_name, doc.payee_name),
      payee_tax_id:
        doc.payee_tax_id === null ? missing : present(doc.payee_tax_id, doc.payee_tax_id),
      invoice_number: present(doc.invoice_number, doc.invoice_number),
      issue_date: present(doc.issue_date, lit("issue_date") ?? ""),
      due_date: doc.due_date === null ? missing : present(doc.due_date, lit("due_date") ?? ""),
      currency: present(doc.currency, doc.currency),
      subtotal: amountField(doc.subtotal),
      taxes: amountField(doc.taxes),
      total: present(doc.total, formatAmount(doc.total, template.locale)),
      bank_account:
        doc.bank_account === null ? missing : present(doc.bank_account, doc.bank_account),
      bank_holder: doc.bank_holder === null ? missing : present(doc.bank_holder, doc.bank_holder),
      hours: doc.hours === null ? missing : present(doc.hours, String(doc.hours)),
      purchase_order:
        doc.purchase_order === null ? missing : present(doc.purchase_order, doc.purchase_order),
      description: present(doc.description, doc.description),
    },
    ambiguities: [],
    suspicions: [],
  };
}
