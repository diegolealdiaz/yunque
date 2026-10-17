import { and, asc, count, desc, eq, gte, inArray, ne } from "drizzle-orm";

import {
  InvoiceSchema,
  canTransition,
  type Invoice,
  type InvoiceStatus,
  type ReceiptKey,
  type Sha256,
  type Ulid,
} from "@/src/domain";

import type { Executor } from "../client";
import { DbError, isUniqueViolation } from "../errors";
import { parseRow } from "../rows";
import { invoices } from "../schema";

/**
 * Facturas. La identidad idempotente es la entrega (`receipt_key`), única por organización:
 * la misma entrega dos veces produce `conflict`, que el caso de uso traduce en "ya existe".
 * El mismo archivo por otra entrega es otra factura; el motor la frena como duplicada.
 */

function toRow(inv: Invoice): typeof invoices.$inferInsert {
  return {
    id: inv.id,
    organizationId: inv.organization_id,
    reference: inv.reference,
    channel: inv.channel,
    receiptKey: inv.receipt_key,
    sourceKind: inv.source_kind,
    documentHash: inv.document_hash,
    fileKey: inv.file_key,
    fileState: inv.file_state,
    originalName: inv.original_name,
    mimeType: inv.mime_type,
    sizeBytes: inv.size_bytes,
    pageKeys: [...inv.page_keys],
    text: inv.text,
    semanticKey: inv.semantic_key,
    status: inv.status,
    approvalExpiresAt: inv.approval_expires_at,
    channelMeta: inv.channel_meta,
    receivedAt: inv.received_at,
    updatedAt: inv.updated_at,
  };
}

function toInvoice(row: typeof invoices.$inferSelect): Invoice {
  return parseRow(
    InvoiceSchema,
    {
      id: row.id,
      organization_id: row.organizationId,
      reference: row.reference,
      channel: row.channel,
      receipt_key: row.receiptKey,
      source_kind: row.sourceKind,
      document_hash: row.documentHash,
      file_key: row.fileKey,
      file_state: row.fileState,
      original_name: row.originalName,
      mime_type: row.mimeType,
      size_bytes: row.sizeBytes,
      page_keys: row.pageKeys,
      text: row.text,
      semantic_key: row.semanticKey,
      status: row.status,
      approval_expires_at: row.approvalExpiresAt,
      channel_meta: row.channelMeta,
      received_at: row.receivedAt,
      updated_at: row.updatedAt,
    },
    "invoices",
  );
}

/** Inserta una factura nueva. La misma entrega o la misma referencia producen `conflict`. */
export async function insertInvoice(exec: Executor, invoice: Invoice): Promise<void> {
  try {
    await exec.insert(invoices).values(toRow(InvoiceSchema.parse(invoice)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DbError("conflict", "Ya existe una factura con esa entrega o referencia");
    }
    throw error;
  }
}

/** Factura por id dentro de la organización; `not_found` si no existe. */
export async function getInvoice(exec: Executor, organizationId: Ulid, id: Ulid): Promise<Invoice> {
  const row = await exec.query.invoices.findFirst({
    where: and(eq(invoices.organizationId, organizationId), eq(invoices.id, id)),
  });
  if (!row) throw new DbError("not_found", `Factura ${id} no existe`);
  return toInvoice(row);
}

/** Facturas del conjunto de ids que pertenecen a la organización. */
export async function listInvoicesByIds(
  exec: Executor,
  organizationId: Ulid,
  ids: readonly Ulid[],
): Promise<Invoice[]> {
  if (ids.length === 0) return [];
  const rows = await exec.query.invoices.findMany({
    where: and(eq(invoices.organizationId, organizationId), inArray(invoices.id, [...ids])),
  });
  return rows.map(toInvoice);
}

/** Factura de esa entrega, o null si la entrega es nueva. */
export async function findInvoiceByReceiptKey(
  exec: Executor,
  organizationId: Ulid,
  receiptKey: ReceiptKey,
): Promise<Invoice | null> {
  const row = await exec.query.invoices.findFirst({
    where: and(eq(invoices.organizationId, organizationId), eq(invoices.receiptKey, receiptKey)),
  });
  return row ? toInvoice(row) : null;
}

/** La factura con esa referencia de pantalla (`YQ-2026-10-0001`), o null. */
export async function findInvoiceByReference(
  exec: Executor,
  organizationId: Ulid,
  reference: string,
): Promise<Invoice | null> {
  const row = await exec.query.invoices.findFirst({
    where: and(eq(invoices.organizationId, organizationId), eq(invoices.reference, reference)),
  });
  return row ? toInvoice(row) : null;
}

/** Facturas con ese hash de archivo, la primera recibida primero. */
export async function listInvoicesByDocumentHash(
  exec: Executor,
  organizationId: Ulid,
  documentHash: Sha256,
): Promise<Invoice[]> {
  const rows = await exec.query.invoices.findMany({
    where: and(
      eq(invoices.organizationId, organizationId),
      eq(invoices.documentHash, documentHash),
    ),
    orderBy: [asc(invoices.receivedAt), asc(invoices.id)],
    limit: 50,
  });
  return rows.map(toInvoice);
}

/** Facturas con la misma llave semántica recibidas desde `since` (ISO), sin incluir `excludeId`. */
export async function findInvoicesBySemanticKey(
  exec: Executor,
  organizationId: Ulid,
  semanticKey: string,
  since: string,
  excludeId: Ulid,
): Promise<Invoice[]> {
  const rows = await exec.query.invoices.findMany({
    where: and(
      eq(invoices.organizationId, organizationId),
      eq(invoices.semanticKey, semanticKey),
      gte(invoices.receivedAt, since),
      ne(invoices.id, excludeId),
    ),
    orderBy: [desc(invoices.receivedAt)],
    limit: 50,
  });
  return rows.map(toInvoice);
}

/** Facturas de la organización, más recientes primero, con filtro opcional por estado. */
export async function listInvoices(
  exec: Executor,
  organizationId: Ulid,
  filter: { status?: InvoiceStatus; limit?: number } = {},
): Promise<Invoice[]> {
  const rows = await exec.query.invoices.findMany({
    where: and(
      eq(invoices.organizationId, organizationId),
      filter.status === undefined ? undefined : eq(invoices.status, filter.status),
    ),
    orderBy: [desc(invoices.receivedAt)],
    limit: filter.limit ?? 200,
  });
  return rows.map(toInvoice);
}

export type InvoicePatch = Partial<
  Pick<Invoice, "text" | "semantic_key" | "page_keys" | "file_state" | "approval_expires_at">
>;

/**
 * Transición por comparación y cambio: `UPDATE ... WHERE status = from`. Si la fila ya no
 * está en `from`, no se escribe nada y se lanza `stale_state`. Una transición no permitida
 * por la máquina de estados se rechaza antes de tocar la base.
 */
export async function transitionInvoice(
  exec: Executor,
  organizationId: Ulid,
  id: Ulid,
  from: InvoiceStatus,
  to: InvoiceStatus,
  now: string,
  patch: InvoicePatch = {},
): Promise<void> {
  if (!canTransition(from, to)) {
    throw new DbError("stale_state", `Transición no permitida: ${from} → ${to}`);
  }
  const result = await exec
    .update(invoices)
    .set({
      status: to,
      updatedAt: now,
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.semantic_key !== undefined ? { semanticKey: patch.semantic_key } : {}),
      ...(patch.page_keys !== undefined ? { pageKeys: [...patch.page_keys] } : {}),
      ...(patch.file_state !== undefined ? { fileState: patch.file_state } : {}),
      ...(patch.approval_expires_at !== undefined
        ? { approvalExpiresAt: patch.approval_expires_at }
        : {}),
    })
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.id, id),
        eq(invoices.status, from),
      ),
    );
  if (result.rowsAffected === 0) {
    throw new DbError("stale_state", `La factura ${id} ya no está en ${from}`);
  }
}

/** Facturas recibidas por la organización desde `since` (ISO): base del tope por visitante. */
export async function countInvoicesSince(
  exec: Executor,
  organizationId: Ulid,
  since: string,
): Promise<number> {
  const [row] = await exec
    .select({ n: count() })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), gte(invoices.receivedAt, since)));
  return row?.n ?? 0;
}

/**
 * Facturas recibidas por todas las organizaciones desde `since`: base del tope global de la
 * demo pública. Es la única consulta sin filtro de organización, y solo devuelve un número.
 */
export async function countAllInvoicesSince(exec: Executor, since: string): Promise<number> {
  const [row] = await exec
    .select({ n: count() })
    .from(invoices)
    .where(gte(invoices.receivedAt, since));
  return row?.n ?? 0;
}
