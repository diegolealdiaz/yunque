import { get, put } from "@vercel/blob";

import { assertSafeKey, type FileStorage } from "./storage";

/**
 * Almacenamiento en Vercel Blob para el despliegue: en Vercel el disco es de solo lectura.
 * El almacén es privado: los archivos no tienen URL pública y solo el servidor los lee con
 * el token; el navegador recibe las páginas por la ruta que valida la empresa. Las llaves
 * son las mismas que en disco y se escriben sin sufijo aleatorio; escribir dos veces la
 * misma llave deja el mismo contenido (va por hash), así que se permite sobrescribir.
 */

/** Las dos operaciones del SDK que se usan; inyectables para pruebas. */
export type BlobApi = {
  readonly put: typeof put;
  readonly get: typeof get;
};

export class BlobFileStorage implements FileStorage {
  constructor(
    private readonly token: string,
    private readonly api: BlobApi = { put, get },
  ) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.api.put(key, Buffer.from(bytes), {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      token: this.token,
    });
  }

  async get(key: string): Promise<Uint8Array> {
    assertSafeKey(key);
    const result = await this.api.get(key, { access: "private", token: this.token });
    if (result?.statusCode !== 200) throw new Error(`No existe ${key}`);
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }
}
