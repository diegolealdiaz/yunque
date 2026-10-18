import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { MemoryFileStorage, normalizeDocument, receiveDocument } from "@/src/extraction";

import {
  DATASET_DIR,
  HISTORY_DIR_NAME,
  OUTPUT_DIR_NAME,
  type DatasetSources,
  type GenerationResult,
} from "./generate";
import { historyCase } from "./history";
import { idealExtraction } from "./ideal";
import { HISTORY_DOCUMENTS_FILE, SAMPLE_PREFIX } from "./demo-seed";
import { HistoryDocumentsSchema, type HistoryDocument } from "./schema";

/**
 * Las páginas y la lectura de cada factura del historial, hechas una sola vez al generar el
 * dataset con la misma ingesta que una factura real: PNG por página y posición de cada
 * carácter, para enmarcar las citas. La semilla de la demo solo lee el resultado, así crear
 * una empresa de ejemplo no renderiza nada ni escribe archivos.
 *
 * Los archivos se sirven bajo el prefijo `muestra/` desde `generado/` (ver
 * `BundledFileStorage`): `muestra/historial/<hash>/pagina-1.png` es
 * `generado/historial/<hash>/pagina-1.png`.
 */

const LIMITS = { maxUploadBytes: 5 * 1024 * 1024, maxPages: 5 } as const;

export async function writeHistoryDocuments(
  result: GenerationResult,
  sources: DatasetSources,
  dir: string = DATASET_DIR,
): Promise<readonly HistoryDocument[]> {
  const out = path.join(dir, OUTPUT_DIR_NAME);
  const prefix = `${SAMPLE_PREFIX}/${HISTORY_DIR_NAME}`;
  const documents: HistoryDocument[] = [];
  for (const [index, entry] of sources.history.entries()) {
    const generated = result.truth.history[index];
    const bytes = generated ? result.files.get(generated.file) : undefined;
    if (!generated || !bytes) throw new Error(`Falta el PDF de ${entry.invoice_number}`);
    const storage = new MemoryFileStorage();
    const received = receiveDocument(
      { bytes, originalName: path.basename(generated.file), storagePrefix: prefix },
      LIMITS,
    );
    const doc = await normalizeDocument(received, prefix, storage, LIMITS);
    for (const [key, file] of storage.files) {
      const target = path.join(out, key.slice(SAMPLE_PREFIX.length + 1));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.bytes);
    }
    const c = historyCase(entry, index, sources.manifest);
    const template = sources.templates.get(c.template);
    if (!template) throw new Error(`Plantilla ${c.template} no cargada`);
    documents.push({
      invoice_number: entry.invoice_number,
      document_hash: received.document_hash,
      file_key: `${SAMPLE_PREFIX}/${generated.file}`,
      size_bytes: received.size_bytes,
      text: doc.text,
      page_keys: doc.pages.map((p) => p.pngKey),
      extraction: idealExtraction(c, template),
    });
  }
  await writeFile(
    path.join(out, HISTORY_DIR_NAME, HISTORY_DOCUMENTS_FILE),
    `${JSON.stringify(HistoryDocumentsSchema.parse(documents), null, 2)}\n`,
  );
  return documents;
}
