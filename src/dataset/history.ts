import type { DatasetCase, HistoryEntry, Manifest } from "./schema";

/**
 * Cada factura del historial como un caso del dataset, para pintarla con la misma plantilla
 * que las del lote. Nada se inventa aparte: el documento parte del caso del lote de su
 * beneficiario (plantilla, NIT, cuenta, descripción) y cambia solo lo que dice el historial
 * (número, fechas, monto) y la cuenta, si la factura trajo otra.
 */

const MONTHS: Readonly<Record<string, readonly string[]>> = {
  es: [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  pt: [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ],
};

/** La descripción del lote con el mes de la factura: "Hosting y soporte, julio 2026". */
function withMonth(description: string, month: number): string {
  for (const names of Object.values(MONTHS)) {
    const october = names[9];
    const target = names[month - 1];
    if (october && target && description.includes(october)) {
      return description.replace(october, target);
    }
  }
  return description;
}

/** Días después de la emisión en que vence una factura del historial. */
const DUE_AFTER_DAYS = 15;

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Id del caso de una factura del historial, por su posición: `historial_01`. */
export function historyCaseId(index: number): string {
  return `historial_${String(index + 1).padStart(2, "0")}`;
}

/**
 * El caso del lote que sirve de base para un beneficiario: el primero en PDF, y entre ellos
 * uno normal si lo hay.
 */
function baseCaseFor(vendorKey: string, manifest: Manifest): DatasetCase {
  const own = manifest.cases.filter(
    (c) => c.document.vendor_key === vendorKey && c.format === "pdf",
  );
  const base = own.find((c) => c.group === "normal") ?? own[0];
  if (!base) throw new Error(`Ningún caso del lote sirve de base para ${vendorKey}`);
  return base;
}

export function historyCase(entry: HistoryEntry, index: number, manifest: Manifest): DatasetCase {
  const base = baseCaseFor(entry.vendor_key, manifest);
  const doc = base.document;
  const issued = entry.received_at.slice(0, 10);
  // Los impuestos guardan la proporción del caso base, así subtotal más impuestos da el total.
  const taxes =
    doc.taxes === null || doc.total === 0
      ? null
      : Math.round((entry.amount * doc.taxes) / doc.total);
  return {
    id: historyCaseId(index),
    group: "normal",
    template: base.template,
    format: "pdf",
    same_document_as: null,
    channel: null,
    document: {
      ...doc,
      invoice_number: entry.invoice_number,
      issue_date: issued,
      due_date: addDays(issued, DUE_AFTER_DAYS),
      currency: entry.currency,
      subtotal: doc.subtotal === null ? null : entry.amount - (taxes ?? 0),
      taxes,
      total: entry.amount,
      // El monto en letras del caso base ya no correspondería: se omite.
      total_in_words: null,
      bank_account: entry.bank_account ?? doc.bank_account,
      description: withMonth(doc.description, Number(issued.slice(5, 7))),
      extra: null,
      hidden_text: null,
    },
    expected: {
      verdict: entry.verdict,
      rule: entry.rule,
      reason: "Factura del historial de ejemplo, decidida antes de la demo",
    },
  };
}
