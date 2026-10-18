import path from "node:path";

import { getConfig } from "@/src/config";
import { SAMPLE_PREFIX } from "@/src/dataset/demo-seed";
import { BundledFileStorage, LocalFileStorage, type FileStorage } from "@/src/extraction";
import { BlobFileStorage } from "@/src/extraction/blob-storage";

/**
 * Almacenamiento de archivos de la app: originales, páginas renderizadas y posiciones del
 * texto. Con `BLOB_READ_WRITE_TOKEN` (el despliegue), un almacén privado de Vercel Blob; sin
 * él, una carpeta local ignorada por git (`data/files`). Las llaves `muestra/` son las
 * facturas del historial de ejemplo y se leen del dataset que viene con la app.
 */
let storage: FileStorage | undefined;

export function fileStorage(): FileStorage {
  const token = getConfig().blob.token;
  storage ??= new BundledFileStorage(
    SAMPLE_PREFIX,
    path.join(process.cwd(), "data", "dataset", "generado"),
    token === null
      ? new LocalFileStorage(path.join(process.cwd(), "data", "files"))
      : new BlobFileStorage(token),
  );
  return storage;
}
