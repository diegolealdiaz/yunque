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
import { GALLERY, GALLERY_PREVIEW_DIR } from "./gallery";
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

/**
 * La miniatura de cada caso de la galería: la primera página, renderizada con la misma
 * ingesta (en un correo, la de su adjunto), en `public/muestras/<id>.png`.
 */
export async function writeGalleryPreviews(
  result: GenerationResult,
  root: string = process.cwd(),
): Promise<number> {
  const out = path.join(root, "public", GALLERY_PREVIEW_DIR);
  await mkdir(out, { recursive: true });
  for (const { id } of GALLERY) {
    const generated = result.truth.cases.find((c) => c.id === id);
    const bytes = generated ? result.files.get(generated.file) : undefined;
    if (!generated || !bytes) throw new Error(`La galería nombra un caso que no existe: ${id}`);
    const storage = new MemoryFileStorage();
    const received = receiveDocument(
      { bytes, originalName: generated.file, storagePrefix: "galeria" },
      LIMITS,
    );
    const doc = await normalizeDocument(received, "galeria", storage, LIMITS);
    const first = doc.pages[0];
    const png = first ? storage.files.get(first.pngKey)?.bytes : undefined;
    if (!png) throw new Error(`El caso ${id} no tiene página para la miniatura`);
    await writeFile(path.join(out, `${id}.png`), png);
  }
  return GALLERY.length;
}
