import type { CaseDocument, DocumentTemplate, TemplateFieldName } from "./schema";

/**
 * Cómo se pinta cada valor en el documento según la convención local. Lo que sale de aquí
 * es la cadena literal que el Lector debe citar; la verdad esperada la guarda tal cual.
 */

export type Locale = DocumentTemplate["locale"];

const SEPARATORS: Record<Locale, { group: string; decimal: string }> = {
  "es-CO": { group: ".", decimal: "," },
  "es-MX": { group: ",", decimal: "." },
  "en-US": { group: ",", decimal: "." },
  "de-DE": { group: ".", decimal: "," },
};

/** Monto en unidad mínima a texto con dos decimales y separadores del locale: 4.800.000,00. */
export function formatAmount(minor: number, locale: Locale): string {
  const { group, decimal } = SEPARATORS[locale];
  const negative = minor < 0;
  const abs = Math.abs(minor).toString().padStart(3, "0");
  const intPart = abs.slice(0, -2);
  const fracPart = abs.slice(-2);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? "-" : ""}${grouped}${decimal}${fracPart}`;
}

/** Fecha ISO a la convención local: 25/10/2026, 10/25/2026 o 25.10.2026. */
export function formatDate(iso: string, locale: Locale): string {
  const [y, m, d] = iso.split("-");
  switch (locale) {
    case "en-US":
      return `${m ?? ""}/${d ?? ""}/${y ?? ""}`;
    case "de-DE":
      return `${d ?? ""}.${m ?? ""}.${y ?? ""}`;
    default:
      return `${d ?? ""}/${m ?? ""}/${y ?? ""}`;
  }
}

/** Valor literal de un campo del documento, o null si el campo no se pinta. */
export function fieldLiteral(
  doc: CaseDocument,
  name: TemplateFieldName,
  locale: Locale,
): string | null {
  switch (name) {
    case "payee_name":
      return doc.payee_name;
    case "payee_tax_id":
      return doc.payee_tax_id;
    case "invoice_number":
      return doc.invoice_number;
    case "issue_date":
      return formatDate(doc.issue_date, locale);
    case "due_date":
      return doc.due_date === null ? null : formatDate(doc.due_date, locale);
    case "currency":
      return doc.currency;
    case "subtotal":
      return doc.subtotal === null ? null : formatAmount(doc.subtotal, locale);
    case "taxes":
      return doc.taxes === null ? null : formatAmount(doc.taxes, locale);
    case "total":
      return formatAmount(doc.total, locale);
    case "total_in_words":
      return doc.total_in_words;
    case "bank_account":
      return doc.bank_account;
    case "bank_holder":
      return doc.bank_holder;
    case "hours":
      return doc.hours === null ? null : String(doc.hours);
    case "purchase_order":
      return doc.purchase_order;
    case "description":
      return doc.description;
    case "customer":
      return "Forja Labs Inc.";
    case "extra":
      return doc.extra;
  }
}
