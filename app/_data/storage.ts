import path from "node:path";

import { LocalFileStorage, type FileStorage } from "@/src/extraction";

/**
 * Almacenamiento de archivos de la app: originales, páginas renderizadas y posiciones del
 * texto. En desarrollo, una carpeta local ignorada por git (`data/files`). En el despliegue
 * (paso 29) se reemplaza por Vercel Blob detrás de la misma interfaz.
 */
let storage: FileStorage | undefined;

export function fileStorage(): FileStorage {
  storage ??= new LocalFileStorage(path.join(process.cwd(), "data", "files"));
  return storage;
}
