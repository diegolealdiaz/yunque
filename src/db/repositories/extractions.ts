import { and, desc, eq } from "drizzle-orm";

import {
  ExtractionRecordSchema,
  type ExtractionRecord,
  type Sha256,
  type Ulid,
} from "@/src/domain";

import type { Executor } from "../client";
import { parseRow } from "../rows";
import { extractionCache, extractions } from "../schema";

/**
 * Extracciones. Dos tablas con propósitos distintos:
 * - `extractions`: la lectura con la que se decidió cada factura. Se escribe en la
 *   transacción de la decisión y permite recomputar el veredicto sin llamar al modelo.
 * - `extraction_cache`: la caché exacta del Lector, por hash de la llave de lectura.
 */

export type StoredExtraction = {
  readonly id: Ulid;
  readonly organization_id: Ulid;
  readonly invoice_id: Ulid;
  readonly document_hash: Sha256;
  readonly record: ExtractionRecord;
  readonly created_at: string;
};

/** Guarda la extracción que alimentó una decisión. */
export async function insertExtraction(
  exec: Executor,
  extraction: StoredExtraction,
): Promise<void> {
  await exec.insert(extractions).values({
    id: extraction.id,
    organizationId: extraction.organization_id,
    invoiceId: extraction.invoice_id,
    documentHash: extraction.document_hash,
    record: ExtractionRecordSchema.parse(extraction.record),
    createdAt: extraction.created_at,
  });
}

/** Última extracción de una factura, o null si todavía no se leyó. */
export async function getLatestExtraction(
  exec: Executor,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<StoredExtraction | null> {
  const row = await exec.query.extractions.findFirst({
    where: and(
      eq(extractions.organizationId, organizationId),
      eq(extractions.invoiceId, invoiceId),
    ),
    orderBy: [desc(extractions.createdAt), desc(extractions.id)],
  });
  if (!row) return null;
  return {
    id: row.id,
    organization_id: row.organizationId,
    invoice_id: row.invoiceId,
    document_hash: row.documentHash,
    record: parseRow(ExtractionRecordSchema, row.record, "extractions"),
    created_at: row.createdAt,
  };
}

/** Lectura cacheada para esa llave, o null. Una fila corrupta sale como `DbError("corrupt")`. */
export async function getCachedExtraction(
  exec: Executor,
  scope: string,
  keyHash: string,
): Promise<ExtractionRecord | null> {
  const row = await exec.query.extractionCache.findFirst({
    where: and(eq(extractionCache.scope, scope), eq(extractionCache.keyHash, keyHash)),
  });
  return row ? parseRow(ExtractionRecordSchema, row.record, "extraction_cache") : null;
}

/** Guarda una lectura en la caché. Si la llave ya existe, se conserva la primera. */
export async function putCachedExtraction(
  exec: Executor,
  scope: string,
  keyHash: string,
  record: ExtractionRecord,
  now: string,
): Promise<void> {
  await exec
    .insert(extractionCache)
    .values({ scope, keyHash, record: ExtractionRecordSchema.parse(record), createdAt: now })
    .onConflictDoNothing();
}
