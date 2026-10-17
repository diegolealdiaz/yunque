import type { Database } from "@/src/db/client";
import {
  listDecisionsSince,
  listInvoices,
  listInvoicesByIds,
  listLatestDecisions,
  listLatestExtractions,
  listPolicyVersions,
  listVendors,
} from "@/src/db/repositories";
import {
  isPresent,
  type Decision,
  type FindingCode,
  type Invoice,
  type Money,
  type Ulid,
  type Verdict,
} from "@/src/domain";
import { decidingFinding } from "@/src/engine";

/**
 * Bandeja de pendientes (docs/interfaz.md §5.1): lo que espera a una persona primero, lo que
 * el agente frenó después, y lo que pagó solo en una línea. La pantalla solo presenta esto;
 * no recalcula veredictos ni montos (docs/practicas.md 75).
 */

export type InboxRow = {
  readonly invoiceId: Ulid;
  readonly reference: string;
  /** Nombre del vendor registrado si se resolvió; si no, el nombre leído del documento. */
  readonly payeeName: string | null;
  readonly amount: Money | null;
  readonly dueDate: string | null;
  readonly verdict: Verdict;
  /** La regla que explica el veredicto, con su valor y su umbral. */
  readonly rule: {
    readonly code: FindingCode;
    readonly observed: string;
    readonly threshold: string;
  } | null;
  readonly policyVersion: number | null;
  readonly decidedAt: string;
  /** La espera de aprobación venció: hay que mirarla ya. */
  readonly expired: boolean;
};

export type Inbox = {
  /** Escaladas que esperan a una persona, por vencimiento: lo urgente es lo que vence. */
  readonly waiting: readonly InboxRow[];
  /** Frenadas desde `decidedSince`, las más recientes primero. */
  readonly stopped: readonly InboxRow[];
  /** Pagadas por el agente desde `decidedSince`. */
  readonly paid: readonly InboxRow[];
};

export type InboxWindow = {
  /** Inicio del día de hoy: frenadas y pagadas desde este instante (ISO). */
  readonly decidedSince: string;
  readonly now: Date;
};

/** Orden de la bandeja: vencimiento más cercano primero; sin vencimiento, al final. */
export function byDueDate(a: InboxRow, b: InboxRow): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : 0;
}

export async function loadInbox(
  db: Database,
  organizationId: Ulid,
  window: InboxWindow,
): Promise<Inbox> {
  const [waitingInvoices, recent, vendors, policies] = await Promise.all([
    listInvoices(db, organizationId, { status: "esperando_aprobacion", limit: 500 }),
    listDecisionsSince(db, organizationId, window.decidedSince),
    listVendors(db, organizationId),
    listPolicyVersions(db, organizationId),
  ]);

  // Solo cuentan las facturas cuya decisión vigente es la de hoy y siguen decididas.
  const recentIds = [...new Set(recent.map((d) => d.invoice_id))];
  const recentInvoices = (await listInvoicesByIds(db, organizationId, recentIds)).filter(
    (inv) => inv.status === "decidida",
  );
  const invoices = [...waitingInvoices, ...recentInvoices];
  const ids = invoices.map((inv) => inv.id);
  const [decisions, extractions] = await Promise.all([
    listLatestDecisions(db, organizationId, ids),
    listLatestExtractions(db, organizationId, ids),
  ]);

  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const policyNumber = new Map(policies.map((p) => [p.id, p.version]));

  const toRow = (invoice: Invoice, decision: Decision): InboxRow => {
    const extraction = extractions.get(invoice.id)?.record.extraction;
    const fields = extraction?.kind === "invoice" ? extraction.fields : null;
    const deciding = decidingFinding(decision);
    return {
      invoiceId: invoice.id,
      reference: invoice.reference,
      payeeName:
        (decision.vendor_id ? vendorName.get(decision.vendor_id) : undefined) ??
        fields?.payee_name.value ??
        null,
      amount: decision.amount,
      dueDate: fields && isPresent(fields.due_date) ? fields.due_date.value : null,
      verdict: decision.verdict,
      rule: deciding
        ? { code: deciding.code, observed: deciding.observed, threshold: deciding.threshold }
        : null,
      policyVersion: policyNumber.get(decision.policy_version_id) ?? null,
      decidedAt: decision.decided_at,
      expired:
        invoice.approval_expires_at !== null &&
        Date.parse(invoice.approval_expires_at) < window.now.getTime(),
    };
  };

  const rows = invoices.flatMap((invoice) => {
    const decision = decisions.get(invoice.id);
    return decision ? [{ invoice, row: toRow(invoice, decision) }] : [];
  });
  const newestFirst = (a: InboxRow, b: InboxRow) => (a.decidedAt < b.decidedAt ? 1 : -1);
  const decidedToday = (row: InboxRow) => row.decidedAt >= window.decidedSince;

  return {
    waiting: rows
      .filter(({ invoice }) => invoice.status === "esperando_aprobacion")
      .map(({ row }) => row)
      .sort(byDueDate),
    stopped: rows
      .filter(({ invoice, row }) => invoice.status === "decidida" && row.verdict === "frenar")
      .map(({ row }) => row)
      .filter(decidedToday)
      .sort(newestFirst),
    paid: rows
      .filter(({ invoice, row }) => invoice.status === "decidida" && row.verdict === "pagar")
      .map(({ row }) => row)
      .filter(decidedToday)
      .sort(newestFirst),
  };
}
