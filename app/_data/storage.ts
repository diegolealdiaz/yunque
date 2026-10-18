import path from "node:path";

import { SAMPLE_PREFIX } from "@/src/dataset/demo-seed";
import { BundledFileStorage, LocalFileStorage, type FileStorage } from "@/src/extraction";

/**
 * Almacenamiento de archivos de la app: originales, páginas renderizadas y posiciones del
 * texto. En desarrollo, una carpeta local ignorada por git (`data/files`). En el despliegue
 * (paso 29) se reemplaza por Vercel Blob detrás de la misma interfaz. Las llaves `muestra/`
 * son las facturas del historial de ejemplo y se leen del dataset que viene con la app.
 */
let storage: FileStorage | undefined;

export function fileStorage(): FileStorage {
  storage ??= new BundledFileStorage(
    SAMPLE_PREFIX,
    path.join(process.cwd(), "data", "dataset", "generado"),
    new LocalFileStorage(path.join(process.cwd(), "data", "files")),
  );
  return storage;
}
