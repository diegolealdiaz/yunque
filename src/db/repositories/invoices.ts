import { and, desc, eq, gte, ne } from "drizzle-orm";

import {
  InvoiceSchema,
  canTransition,
  type Invoice,
  type InvoiceStatus,
  type Sha256,
  type Ulid,
} from "@/src/domain";

import type { Executor } from "../client";
import { DbError, isUniqueViolation } from "../errors";
import { parseRow } from "../rows";
import { invoices } from "../schema";

/**
 * Facturas. La identidad del archivo es única por organización (`document_hash`): el mismo
 * archivo dos veces produce `conflict`, que el caso de uso traduce en "ya existe".
 */

function toRow(inv: Invoice): typeof invoices.$inferInsert {
  return {
    id: inv.id,
    organizationId: inv.organization_id,
    reference: inv.reference,
    channel: inv.channel,
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

/** Inserta una factura nueva. El mismo documento o la misma referencia producen `conflict`. */
export async function insertInvoice(exec: Executor, invoice: Invoice): Promise<void> {
  try {
    await exec.insert(invoices).values(toRow(InvoiceSchema.parse(invoice)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DbError("conflict", "Ya existe una factura con ese documento o referencia");
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

/** Factura con ese hash de archivo, o null. */
export async function findInvoiceByDocumentHash(
  exec: Executor,
  organizationId: Ulid,
  documentHash: Sha256,
): Promise<Invoice | null> {
  const row = await exec.query.invoices.findFirst({
    where: and(
      eq(invoices.organizationId, organizationId),
      eq(invoices.documentHash, documentHash),
    ),
  });
  return row ? toInvoice(row) : null;
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
