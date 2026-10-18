import { describe, expect, it } from "vitest";

import { BlobFileStorage, type BlobApi } from "@/src/extraction/blob-storage";

/** Un almacén falso con la forma del SDK: guarda en memoria y responde como el privado. */
function fakeBlob() {
  const files = new Map<string, Uint8Array>();
  const options: unknown[] = [];
  const api = {
    put: async (pathname: string, body: unknown, opts: unknown) => {
      options.push(opts);
      files.set(pathname, new Uint8Array(body as Buffer));
      return Promise.resolve({ pathname });
    },
    get: async (pathname: string) => {
      const bytes = files.get(pathname);
      if (!bytes) return Promise.resolve(null);
      return Promise.resolve({ statusCode: 200, stream: new Response(new Uint8Array(bytes)).body });
    },
  } as unknown as BlobApi;
  return { api, files, options };
}

describe("almacén en Vercel Blob (P-148)", () => {
  it("P-148 guarda privado, en la misma llave y sin sufijo, y devuelve los mismos bytes", async () => {
    const { api, files, options } = fakeBlob();
    const storage = new BlobFileStorage("vercel_blob_rw_prueba", api);
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

    await storage.put("org/abc/pagina-1.png", bytes, "image/png");
    await storage.put("org/abc/pagina-1.png", bytes, "image/png");

    expect([...files.keys()]).toEqual(["org/abc/pagina-1.png"]);
    expect(options[0]).toMatchObject({
      access: "private",
      contentType: "image/png",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: "vercel_blob_rw_prueba",
    });
    expect(await storage.get("org/abc/pagina-1.png")).toEqual(bytes);
  });

  it("P-148 una llave que no existe falla, y una llave insegura ni llega al almacén", async () => {
    const { api, options } = fakeBlob();
    const storage = new BlobFileStorage("vercel_blob_rw_prueba", api);

    await expect(storage.get("org/nada.png")).rejects.toThrow("No existe");
    await expect(storage.put("../fuera.png", new Uint8Array([1]), "image/png")).rejects.toThrow(
      RangeError,
    );
    expect(options).toHaveLength(0);
  });
});
