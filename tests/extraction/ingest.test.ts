import { PDFDocument } from "@pdfme/pdf-lib";
import { describe, expect, it } from "vitest";

import {
  IngestError,
  MemoryFileStorage,
  assertSafeKey,
  ingestDocument,
  sniffType,
} from "@/src/extraction";

import { generatedFile } from "./helpers";

const limits = { maxUploadBytes: 5 * 1024 * 1024, maxPages: 5 };
const prefix = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("ingesta (P-52 a P-56)", () => {
  it("P-52 PDF con capa: texto por página, PNG por página y hash del archivo", async () => {
    const storage = new MemoryFileStorage();
    const bytes = await generatedFile("nube_oct.pdf");
    const doc = await ingestDocument(
      { bytes, originalName: "../../etc/passwd.pdf", storagePrefix: prefix },
      storage,
      limits,
    );
    expect(doc.source_kind).toBe("pdf");
    expect(doc.has_text_layer).toBe(true);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]?.text).toContain("TOTAL: 4.800.000,00");
    expect(doc.text).toContain("Nube Andina SAS");
    expect(doc.document_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.file_key).toBe(`${prefix}/${doc.document_hash}/original.pdf`);
    expect(storage.files.get(doc.pages[0]?.pngKey ?? "")?.contentType).toBe("image/png");
    expect(doc.channel_meta).toEqual({});
    expect(doc.channel_text).toBeNull();
  });

  it("P-53 PNG escaneado: sin texto, imagen presente, marcado para visión", async () => {
    const storage = new MemoryFileStorage();
    const bytes = await generatedFile("nube_sep_png.png");
    const doc = await ingestDocument(
      { bytes, originalName: "scan.png", storagePrefix: prefix },
      storage,
      limits,
    );
    expect(doc.source_kind).toBe("image");
    expect(doc.has_text_layer).toBe(false);
    expect(doc.text).toBe("");
    expect(doc.pages[0]?.pngKey.endsWith(".png")).toBe(true);
  });

  it("P-54 tipo por contenido: ejecutable, texto, PNG disfrazado y vacío", async () => {
    const storage = new MemoryFileStorage();
    const ingest = (bytes: Uint8Array, name: string) =>
      ingestDocument({ bytes, originalName: name, storagePrefix: prefix }, storage, limits);
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array(100).fill(0)]);
    await expect(ingest(exe, "factura.pdf")).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(ingest(new TextEncoder().encode("hola"), "factura.pdf")).rejects.toMatchObject({
      code: "unsupported_type",
    });
    await expect(ingest(new Uint8Array(0), "vacio.pdf")).rejects.toMatchObject({ code: "empty" });
    const png = await generatedFile("nube_sep_png.png");
    const disguised = await ingest(png, "factura.pdf");
    expect(disguised.mime_type).toBe("image/png");
    expect(sniffType(new TextEncoder().encode("%PDF-1.7 basura"))).toBe("pdf");
    expect(sniffType(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toBe("json");
    const corrupt = new TextEncoder().encode("%PDF-1.7\nesto no es un pdf");
    await expect(ingest(corrupt, "roto.pdf")).rejects.toMatchObject({ code: "corrupt_document" });
    expect(storage.files.size).toBe(2);
  });

  it("P-55 límites: archivo mayor al tope y PDF con más páginas que el tope", async () => {
    const storage = new MemoryFileStorage();
    const bytes = await generatedFile("nube_oct.pdf");
    await expect(
      ingestDocument({ bytes, originalName: "f.pdf", storagePrefix: prefix }, storage, {
        ...limits,
        maxUploadBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "too_large" });
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 6; i++) pdf.addPage([200, 200]);
    const sixPages = await pdf.save();
    await expect(
      ingestDocument(
        { bytes: sixPages, originalName: "largo.pdf", storagePrefix: prefix },
        storage,
        limits,
      ),
    ).rejects.toMatchObject({ code: "too_many_pages" });
    const error = await ingestDocument(
      { bytes: sixPages, originalName: "largo.pdf", storagePrefix: prefix },
      storage,
      limits,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IngestError);
    if (error instanceof IngestError) expect(error.action.length).toBeGreaterThan(5);
  });

  it("P-56 correo y chat: metadatos conservados y el adjunto pasa por la misma ingesta", async () => {
    const storage = new MemoryFileStorage();
    const email = await ingestDocument(
      {
        bytes: await generatedFile("camila_email.email.json"),
        originalName: "c.json",
        storagePrefix: prefix,
      },
      storage,
      limits,
    );
    expect(email.source_kind).toBe("email");
    expect(email.channel_meta).toMatchObject({
      from: "camila.rojas@ejemplo.co",
      subject: "Cuenta de cobro CR-119",
    });
    expect(email.channel_text).toContain("adjunto la cuenta de cobro");
    expect(email.has_text_layer).toBe(true);
    expect(email.text).toContain("CR-119");
    const attachment = await generatedFile("camila_email.pdf");
    const direct = await ingestDocument(
      { bytes: attachment, originalName: "x.pdf", storagePrefix: prefix },
      storage,
      limits,
    );
    expect(email.document_hash).toBe(direct.document_hash);

    const chat = await ingestDocument(
      {
        bytes: await generatedFile("mateo_chat.chat.json"),
        originalName: "m.json",
        storagePrefix: prefix,
      },
      storage,
      limits,
    );
    expect(chat.source_kind).toBe("chat");
    expect(chat.channel_text).toContain("sprint 42");

    const bad = new TextEncoder().encode(JSON.stringify({ kind: "email", from: "x" }));
    await expect(
      ingestDocument(
        { bytes: bad, originalName: "b.json", storagePrefix: prefix },
        storage,
        limits,
      ),
    ).rejects.toMatchObject({ code: "invalid_channel_payload" });
    const notPdf = new TextEncoder().encode(
      JSON.stringify({
        kind: "chat",
        from: "x",
        sent_at: "2026-10-17T00:00:00.000Z",
        text: "hola",
        attachment: {
          filename: "a.pdf",
          content_type: "application/pdf",
          data_base64: Buffer.from("MZ...").toString("base64"),
        },
      }),
    );
    await expect(
      ingestDocument(
        { bytes: notPdf, originalName: "b.json", storagePrefix: prefix },
        storage,
        limits,
      ),
    ).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("las llaves de almacenamiento nunca aceptan rutas del cliente", () => {
    expect(() => assertSafeKey("org/hash/original.pdf")).not.toThrow();
    for (const bad of ["../x", "/abs", "a//b", "a/../b", "a b", ""])
      expect(() => assertSafeKey(bad), bad).toThrow(RangeError);
  });
});
