import { and, desc, eq, inArray, or } from "drizzle-orm";

import {
  InvoiceStatusSchema,
  VerdictSchema,
  isSupportedCurrency,
  money,
  type InvoiceStatus,
  type Money,
  type Sha256,
  type Ulid,
  type Verdict,
} from "@/src/domain";

import type { Executor } from "../client";
import { DbError } from "../errors";
import { decisions, invoices } from "../schema";

/**
 * Historial que el motor necesita para duplicados, primer pago, frecuencia y monto atípico.
 * Junta las facturas anteriores del mismo vendor, con la misma llave semántica o con el
 * mismo archivo, cada una con su resultado conocido: el veredicto vigente o la resolución
 * humana. La forma coincide con `PriorInvoice` del motor.
 */

export type PriorInvoiceRow = {
  readonly invoice_id: Ulid;
  readonly reference: string;
  readonly vendor_id: Ulid | null;
  readonly document_hash: Sha256;
  readonly semantic_key: string | null;
  readonly amount: Money | null;
  /** Fecha de emisión leída (ISO), o null si no se leyó. Para reglas de historial por periodo. */
  readonly issue_date: string | null;
  readonly received_at: string;
  readonly outcome: Verdict | "simulada" | "aprobada" | "rechazada" | "pendiente";
};

export type PriorInvoiceQuery = {
  /** Vendor resuelto de la factura actual; null si el beneficiario no se reconoció. */
  readonly vendorId: Ulid | null;
  readonly semanticKey: string | null;
  readonly documentHash: Sha256;
  /** La factura que se evalúa nunca es parte de su propio historial. */
  readonly excludeInvoiceId: Ulid;
};

/** Tope de facturas previas por criterio. Acota el contexto del motor y el costo de la consulta. */
const MAX_PRIOR = 500;

/**
 * Resultado conocido de una factura previa. `esperando_aprobacion` cuenta como escalada;
 * una factura sin decisión todavía cuenta como pendiente; un `pagar` en modo de prueba es
 * `simulada`, para que un pago que nunca ocurrió no habilite el siguiente.
 */
function outcomeOf(
  status: InvoiceStatus,
  verdict: Verdict | null,
  dryRun: boolean,
): PriorInvoiceRow["outcome"] {
  switch (status) {
    case "aprobada":
    case "rechazada":
      return status;
    case "esperando_aprobacion":
      return "escalar";
    case "decidida":
      if (verdict === "pagar" && dryRun) return "simulada";
      return verdict ?? "pendiente";
    case "recibida":
    case "procesando":
    case "fallida":
      return "pendiente";
  }
}

/** Ids de las facturas previas relevantes: por vendor (vía sus decisiones), llave o archivo. */
async function priorInvoiceIds(
  exec: Executor,
  organizationId: Ulid,
  query: PriorInvoiceQuery,
): Promise<Ulid[]> {
  const ids = new Set<Ulid>();
  if (query.vendorId !== null) {
    const byVendor = await exec
      .selectDistinct({ id: decisions.invoiceId })
      .from(decisions)
      .where(
        and(eq(decisions.organizationId, organizationId), eq(decisions.vendorId, query.vendorId)),
      )
      .orderBy(desc(decisions.invoiceId))
      .limit(MAX_PRIOR);
    for (const row of byVendor) ids.add(row.id);
  }
  const byKeyOrFile = await exec
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        or(
          eq(invoices.documentHash, query.documentHash),
          query.semanticKey === null ? undefined : eq(invoices.semanticKey, query.semanticKey),
        ),
      ),
    )
    .orderBy(desc(invoices.receivedAt))
    .limit(MAX_PRIOR);
  for (const row of byKeyOrFile) ids.add(row.id);
  ids.delete(query.excludeInvoiceId);
  return [...ids];
}

/** Facturas previas con su resultado conocido, para el contexto del motor. */
export async function listPriorInvoices(
  exec: Executor,
  organizationId: Ulid,
  query: PriorInvoiceQuery,
): Promise<PriorInvoiceRow[]> {
  const ids = await priorInvoiceIds(exec, organizationId, query);
  if (ids.length === 0) return [];

  const rows = await exec
    .select({
      id: invoices.id,
      reference: invoices.reference,
      status: invoices.status,
      documentHash: invoices.documentHash,
      semanticKey: invoices.semanticKey,
      issueDate: invoices.issueDate,
      receivedAt: invoices.receivedAt,
    })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), inArray(invoices.id, ids)));
  const decided = await exec
    .select({
      invoiceId: decisions.invoiceId,
      verdict: decisions.verdict,
      vendorId: decisions.vendorId,
      amount: decisions.amount,
      amountCurrency: decisions.amountCurrency,
      dryRun: decisions.dryRun,
    })
    .from(decisions)
    .where(and(eq(decisions.organizationId, organizationId), inArray(decisions.invoiceId, ids)))
    .orderBy(desc(decisions.decidedAt), desc(decisions.id));

  // El orden va de la más reciente a la más vieja: la primera fila por factura es la vigente.
  const latest = new Map<Ulid, (typeof decided)[number]>();
  for (const d of decided) if (!latest.has(d.invoiceId)) latest.set(d.invoiceId, d);

  return rows.map((row) => {
    const status = InvoiceStatusSchema.safeParse(row.status);
    if (!status.success) {
      // Datos acumulativos fallan en voz alta: un estado desconocido no se adivina.
      throw new DbError("corrupt", `Estado de factura inválido en base (${row.id})`);
    }
    const d = latest.get(row.id);
    const verdict = d ? VerdictSchema.safeParse(d.verdict) : null;
    const currency = d?.amountCurrency ?? null;
    return {
      invoice_id: row.id,
      reference: row.reference,
      vendor_id: d?.vendorId ?? null,
      document_hash: row.documentHash,
      semantic_key: row.semanticKey,
      amount:
        d && d.amount !== null && currency !== null && isSupportedCurrency(currency)
          ? money(d.amount, currency)
          : null,
      issue_date: row.issueDate,
      received_at: row.receivedAt,
      outcome: outcomeOf(status.data, verdict?.success ? verdict.data : null, d?.dryRun ?? false),
    };
  });
}
