import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Almacenamiento de archivos: el original subido y las páginas renderizadas.
 * Las llaves son rutas lógicas seguras (`org/hash/pagina-1.png`); nunca vienen del cliente.
 */

export interface FileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Rechaza cualquier llave con `..`, barras iniciales o caracteres fuera del alfabeto seguro. */
export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.length > 300) {
    throw new RangeError(`Llave de archivo inválida: ${key}`);
  }
}

/** Implementación en disco para desarrollo y pruebas. Producción usa Vercel Blob. */
export class LocalFileStorage implements FileStorage {
  constructor(private readonly root: string) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertSafeKey(key);
    const target = path.join(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async get(key: string): Promise<Uint8Array> {
    assertSafeKey(key);
    return new Uint8Array(await readFile(path.join(this.root, key)));
  }
}

/** Almacenamiento en memoria para pruebas. */
export class MemoryFileStorage implements FileStorage {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    this.files.set(key, { bytes, contentType });
    return Promise.resolve();
  }

  async get(key: string): Promise<Uint8Array> {
    assertSafeKey(key);
    const entry = this.files.get(key);
    if (!entry) throw new Error(`No existe ${key}`);
    return Promise.resolve(entry.bytes);
  }
}
