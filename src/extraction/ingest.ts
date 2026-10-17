import { PdfBudgetError, PdfError, createEngine, type PdfEngine } from "clawpdf";

import { documentHash, type Sha256, type SourceKind } from "@/src/domain";

import { IngestError } from "./errors";
import { MIME_BY_TYPE, parseChannelPayload, sniffType, type ChannelPayload } from "./sniff";
import type { FileStorage } from "./storage";

/**
 * Ingesta y normalización. De un archivo subido (o un correo o chat con adjunto) produce:
 * hash del documento, tipo verificado por contenido, texto por página si hay capa, PNG por
 * página siempre (la pantalla nunca abre el PDF original), y los metadatos del canal.
 * No toca la base: el caso de uso persiste lo que sale de aquí.
 */

export type IngestLimits = {
  readonly maxUploadBytes: number;
  readonly maxPages: number;
};

export type IngestInput = {
  readonly bytes: Uint8Array;
  /** Nombre que trajo el archivo, solo informativo. */
  readonly originalName: string;
  /** Prefijo de almacenamiento, normalmente el id de la organización. */
  readonly storagePrefix: string;
};

export type IngestedPage = {
  readonly page: number;
  readonly text: string;
  /** Llave del PNG en el almacenamiento. */
  readonly pngKey: string;
  readonly width: number;
  readonly height: number;
};

export type IngestedDocument = {
  readonly source_kind: SourceKind;
  /** Tipo real del documento (el adjunto, en correo y chat). */
  readonly mime_type: string;
  /** Hash de los bytes del documento: en correo y chat, los del adjunto. */
  readonly document_hash: Sha256;
  readonly size_bytes: number;
  readonly file_key: string;
  readonly pages: readonly IngestedPage[];
  /** Texto de todas las páginas; vacío si el documento no tiene capa de texto. */
  readonly text: string;
  readonly has_text_layer: boolean;
  readonly channel_meta: Readonly<Record<string, string>>;
  /** Cuerpo del correo o del chat, para el Detector y el Lector. */
  readonly channel_text: string | null;
};

const RENDER_DPI = 110;
/** Un PDF con capa de texto que suma menos de esto se trata como escaneado. */
const MIN_TEXT_CHARS = 40;
/**
 * Tope de píxeles por página renderizada. Un A4 a 110 dpi son unos 1,2 M; el tope deja
 * margen para formatos grandes y corta páginas gigantes antes de reservar memoria.
 */
export const MAX_PAGE_PIXELS = 15_000_000;
const POINTS_PER_INCH = 72;

/** Motor de PDFium compartido por el proceso: cargar el WebAssembly una vez, no por archivo. */
let enginePromise: Promise<PdfEngine> | undefined;
function pdfEngine(): Promise<PdfEngine> {
  enginePromise ??= createEngine({ maxRenderPixels: MAX_PAGE_PIXELS }).catch((error: unknown) => {
    enginePromise = undefined;
    throw error;
  });
  return enginePromise;
}

function tooLarge(detail: string): IngestError {
  return new IngestError("too_large", detail, "Exporta el PDF en tamaño carta o A4");
}

/** Traduce los errores de PDFium a errores tipados con acción sugerida. */
function pdfFailure(error: unknown): IngestError {
  if (error instanceof IngestError) return error;
  if (error instanceof PdfBudgetError) return tooLarge("Una página del PDF es demasiado grande");
  const detail =
    error instanceof PdfError
      ? `El PDF no se pudo procesar (${error.code})`
      : "El PDF no se pudo procesar";
  return new IngestError("corrupt_document", detail, "Vuelve a exportar el PDF");
}

function assertSize(bytes: Uint8Array, limits: IngestLimits): void {
  if (bytes.length === 0) {
    throw new IngestError("empty", "El archivo está vacío", "Sube un archivo con contenido");
  }
  if (bytes.length > limits.maxUploadBytes) {
    throw new IngestError(
      "too_large",
      `El archivo pesa ${String(bytes.length)} bytes y el máximo es ${String(limits.maxUploadBytes)}`,
      "Sube un archivo más liviano",
    );
  }
}

async function ingestPdf(
  bytes: Uint8Array,
  hash: Sha256,
  prefix: string,
  storage: FileStorage,
  limits: IngestLimits,
): Promise<Pick<IngestedDocument, "pages" | "text" | "has_text_layer">> {
  const engine = await pdfEngine();
  let pdf;
  try {
    pdf = await engine.open(bytes);
  } catch {
    throw new IngestError(
      "corrupt_document",
      "El PDF no se pudo abrir",
      "Vuelve a exportar el PDF",
    );
  }
  try {
    if (pdf.pageCount === 0) {
      throw new IngestError(
        "corrupt_document",
        "El PDF no tiene páginas",
        "Vuelve a exportar el PDF",
      );
    }
    if (pdf.pageCount > limits.maxPages) {
      throw new IngestError(
        "too_many_pages",
        `El PDF tiene ${String(pdf.pageCount)} páginas y el máximo es ${String(limits.maxPages)}`,
        "Sube solo las páginas de la factura",
      );
    }
    const pages: IngestedPage[] = [];
    for (let n = 1; n <= pdf.pageCount; n++) {
      let png: Uint8Array;
      let text: string;
      let width: number;
      let height: number;
      try {
        const page = pdf.page(n);
        ({ width, height } = page);
        const pixels =
          ((width * RENDER_DPI) / POINTS_PER_INCH) * ((height * RENDER_DPI) / POINTS_PER_INCH);
        if (!Number.isFinite(pixels) || pixels > MAX_PAGE_PIXELS) {
          throw tooLarge(`La página ${String(n)} del PDF es demasiado grande para renderizarla`);
        }
        png = await page.png({ dpi: RENDER_DPI, background: "white" });
        text = cleanLayoutText(page.text());
      } catch (error) {
        throw pdfFailure(error);
      }
      // Si una escritura falla a mitad, quedan PNG sin factura bajo el prefijo del hash;
      // la siguiente ingesta del mismo documento los sobrescribe con las mismas llaves.
      const pngKey = `${prefix}/${hash}/pagina-${String(n)}.png`;
      await storage.put(pngKey, png, "image/png");
      pages.push({ page: n, text, pngKey, width, height });
    }
    const text = pages
      .map((p) => p.text)
      .join("\n\n")
      .trim();
    return { pages, text, has_text_layer: text.length >= MIN_TEXT_CHARS };
  } finally {
    pdf.destroy();
  }
}

/**
 * Texto de la capa del PDF listo para verificar: saltos de línea uniformes, tabulaciones
 * como espacio, sin caracteres de control y sin espacios colgantes. No confundir con
 * `normalizeText` del dominio, que produce claves comparables.
 */
function cleanLayoutText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/(?!\n)\p{Cc}/gu, "")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

async function ingestImage(
  bytes: Uint8Array,
  hash: Sha256,
  prefix: string,
  storage: FileStorage,
  type: "png" | "jpeg",
): Promise<Pick<IngestedDocument, "pages" | "text" | "has_text_layer">> {
  const pngKey = `${prefix}/${hash}/pagina-1.${type === "png" ? "png" : "jpg"}`;
  await storage.put(pngKey, bytes, MIME_BY_TYPE[type]);
  return {
    pages: [{ page: 1, text: "", pngKey, width: 0, height: 0 }],
    text: "",
    has_text_layer: false,
  };
}

function channelMeta(payload: ChannelPayload): { meta: Record<string, string>; text: string } {
  if (payload.kind === "email") {
    return {
      meta: {
        from: payload.from,
        sent_at: payload.sent_at,
        subject: payload.subject ?? "",
        attachment: payload.attachment.filename,
      },
      text: [payload.subject ?? "", payload.body].filter((t) => t.length > 0).join("\n"),
    };
  }
  return {
    meta: { from: payload.from, sent_at: payload.sent_at, attachment: payload.attachment.filename },
    text: payload.text,
  };
}

/**
 * Ingiere un archivo. Para correo y chat, el documento es el adjunto; el cuerpo queda como
 * texto del canal. El original siempre se guarda con su hash, nunca con el nombre del cliente.
 */
export async function ingestDocument(
  input: IngestInput,
  storage: FileStorage,
  limits: IngestLimits,
): Promise<IngestedDocument> {
  assertSize(input.bytes, limits);
  const type = sniffType(input.bytes);
  if (type === null) {
    throw new IngestError(
      "unsupported_type",
      "El archivo no es PDF, PNG, JPEG ni un correo o chat en JSON",
      "Sube la factura en PDF o como imagen",
    );
  }

  let documentBytes = input.bytes;
  let sourceKind: SourceKind = type === "pdf" ? "pdf" : "image";
  let meta: Record<string, string> = {};
  let channelText: string | null = null;

  if (type === "json") {
    const payload = parseChannelPayload(input.bytes);
    documentBytes = new Uint8Array(Buffer.from(payload.attachment.data_base64, "base64"));
    assertSize(documentBytes, limits);
    if (sniffType(documentBytes) !== "pdf") {
      throw new IngestError(
        "unsupported_type",
        "El adjunto no es un PDF",
        "Adjunta la factura en PDF",
      );
    }
    sourceKind = payload.kind;
    ({ meta, text: channelText } = channelMeta(payload));
  }

  const hash = documentHash(documentBytes);
  const documentType = type === "json" ? "pdf" : type;
  const mimeType = MIME_BY_TYPE[documentType];
  const extension = documentType === "jpeg" ? "jpg" : documentType;
  const fileKey = `${input.storagePrefix}/${hash}/original.${extension}`;

  // Primero se abre y renderiza; el original solo se guarda si el documento es válido.
  const content =
    documentType === "pdf"
      ? await ingestPdf(documentBytes, hash, input.storagePrefix, storage, limits)
      : await ingestImage(documentBytes, hash, input.storagePrefix, storage, documentType);
  await storage.put(fileKey, documentBytes, mimeType);

  return {
    source_kind: sourceKind,
    mime_type: mimeType,
    document_hash: hash,
    size_bytes: documentBytes.length,
    file_key: fileKey,
    ...content,
    channel_meta: meta,
    channel_text: channelText,
  };
}
