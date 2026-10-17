import { PdfBudgetError, PdfError, createEngine, type PdfEngine } from "clawpdf";

import { documentHash, type Sha256, type SourceKind } from "@/src/domain";

import { IngestError } from "./errors";
import { readPageLayout, type PageLayout } from "./layout";
import { MIME_BY_TYPE, parseChannelPayload, sniffType, type ChannelPayload } from "./sniff";
import type { FileStorage } from "./storage";

/**
 * Ingesta y normalización, en dos fases que el caso de uso separa:
 *
 * 1. `receiveDocument`: valida tamaño y tipo por contenido, abre el correo o chat y toma el
 *    adjunto, y calcula el hash. Un error aquí es una entrega rechazada: no hay factura.
 * 2. `normalizeDocument`: texto por página si hay capa y PNG por página siempre (la pantalla
 *    nunca abre el PDF original). Un error aquí ocurre con la factura ya registrada, que
 *    escala con el error como motivo.
 *
 * `ingestDocument` encadena las dos y guarda el original solo si el documento se pudo abrir.
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
  /**
   * Llave del JSON con el texto y la caja de cada carácter (`PageLayout`), para enmarcar las
   * citas sobre la imagen. Null si la página no tiene capa de texto o PDFium no dio posiciones.
   */
  readonly layoutKey: string | null;
  readonly width: number;
  readonly height: number;
};

/** Documento aceptado: tipo verificado, hash calculado, todavía sin renderizar. */
export type ReceivedDocument = {
  readonly source_kind: SourceKind;
  /** Tipo real del documento (el adjunto, en correo y chat). */
  readonly mime_type: string;
  /** Hash de los bytes del documento: en correo y chat, los del adjunto. */
  readonly document_hash: Sha256;
  readonly size_bytes: number;
  /** Llave del original en el almacenamiento: por hash, nunca con el nombre del cliente. */
  readonly file_key: string;
  /** Bytes del documento: el archivo subido, o el adjunto en correo y chat. */
  readonly bytes: Uint8Array;
  readonly channel_meta: Readonly<Record<string, string>>;
  /** Cuerpo del correo o del chat, para el Detector y el Lector. */
  readonly channel_text: string | null;
};

export type IngestedDocument = Omit<ReceivedDocument, "bytes"> & {
  readonly pages: readonly IngestedPage[];
  /** Texto de todas las páginas; vacío si el documento no tiene capa de texto. */
  readonly text: string;
  readonly has_text_layer: boolean;
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
      // Las posiciones son un extra para la pantalla: si fallan, la factura se procesa igual.
      let layout: PageLayout | null = null;
      try {
        layout = text === "" ? null : readPageLayout(pdf, n);
      } catch {
        layout = null;
      }
      // Si una escritura falla a mitad, quedan PNG sin factura bajo el prefijo del hash;
      // la siguiente ingesta del mismo documento los sobrescribe con las mismas llaves.
      const pngKey = `${prefix}/${hash}/pagina-${String(n)}.png`;
      await storage.put(pngKey, png, "image/png");
      let layoutKey: string | null = null;
      if (layout) {
        layoutKey = `${prefix}/${hash}/texto-${String(n)}.json`;
        await storage.put(
          layoutKey,
          new TextEncoder().encode(JSON.stringify(layout)),
          "application/json",
        );
      }
      pages.push({ page: n, text, pngKey, layoutKey, width, height });
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
    pages: [{ page: 1, text: "", pngKey, layoutKey: null, width: 0, height: 0 }],
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
 * Acepta o rechaza una entrega. Para correo y chat, el documento es el adjunto; el cuerpo
 * queda como texto del canal. No guarda nada: ver `storeOriginal`.
 */
export function receiveDocument(input: IngestInput, limits: IngestLimits): ReceivedDocument {
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
  const documentType = documentTypeOf(type);
  const extension = documentType === "jpeg" ? "jpg" : documentType;
  return {
    source_kind: sourceKind,
    mime_type: MIME_BY_TYPE[documentType],
    document_hash: hash,
    size_bytes: documentBytes.length,
    file_key: `${input.storagePrefix}/${hash}/original.${extension}`,
    bytes: documentBytes,
    channel_meta: meta,
    channel_text: channelText,
  };
}

/** El correo y el chat llevan un PDF adjunto: su documento es un PDF. */
function documentTypeOf(type: "pdf" | "png" | "jpeg" | "json"): "pdf" | "png" | "jpeg" {
  return type === "json" ? "pdf" : type;
}

/** Guarda el original bajo su hash. Escribir dos veces la misma llave deja el mismo contenido. */
export async function storeOriginal(doc: ReceivedDocument, storage: FileStorage): Promise<void> {
  await storage.put(doc.file_key, doc.bytes, doc.mime_type);
}

/** Renderiza las páginas y extrae el texto de un documento ya aceptado. */
export async function normalizeDocument(
  doc: ReceivedDocument,
  storagePrefix: string,
  storage: FileStorage,
  limits: IngestLimits,
): Promise<IngestedDocument> {
  const content =
    doc.mime_type === MIME_BY_TYPE.pdf
      ? await ingestPdf(doc.bytes, doc.document_hash, storagePrefix, storage, limits)
      : await ingestImage(
          doc.bytes,
          doc.document_hash,
          storagePrefix,
          storage,
          doc.mime_type === MIME_BY_TYPE.png ? "png" : "jpeg",
        );
  const { bytes: _bytes, ...rest } = doc;
  return { ...rest, ...content };
}

/**
 * Ingiere un archivo de punta a punta. Primero se abre y renderiza; el original solo se
 * guarda si el documento es válido.
 */
export async function ingestDocument(
  input: IngestInput,
  storage: FileStorage,
  limits: IngestLimits,
): Promise<IngestedDocument> {
  const received = receiveDocument(input, limits);
  const doc = await normalizeDocument(received, input.storagePrefix, storage, limits);
  await storeOriginal(received, storage);
  return doc;
}
