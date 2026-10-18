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

/**
 * Archivos de solo lectura que vienen con la app bajo un prefijo (el historial de ejemplo,
 * ya renderizado en el dataset); lo demás va al almacenamiento de siempre. Crear una empresa
 * de ejemplo no copia esos archivos: sus facturas apuntan a las mismas llaves.
 */
export class BundledFileStorage implements FileStorage {
  constructor(
    private readonly prefix: string,
    private readonly root: string,
    private readonly inner: FileStorage,
  ) {}

  private bundled(key: string): string | null {
    return key.startsWith(`${this.prefix}/`) ? key.slice(this.prefix.length + 1) : null;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (this.bundled(key) !== null) throw new Error(`${key} es de solo lectura`);
    return this.inner.put(key, bytes, contentType);
  }

  async get(key: string): Promise<Uint8Array> {
    assertSafeKey(key);
    const relative = this.bundled(key);
    if (relative === null) return this.inner.get(key);
    return new Uint8Array(await readFile(path.join(this.root, relative)));
  }
}
