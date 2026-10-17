import { z } from "zod";

import type { PdfDocument } from "clawpdf";

/**
 * Posiciones del texto de una página (D11): para cada carácter de la capa de texto, su caja
 * en fracciones de la página. Con ellas la pantalla enmarca la cita de un campo sobre la
 * imagen renderizada, sin abrir el PDF en el navegador.
 *
 * clawpdf no expone estas funciones de PDFium en su API tipada, aunque el WebAssembly las
 * trae. Este módulo las llama a través de una puerta mínima que comprueba en tiempo de
 * ejecución que cada función exista y devuelva números. Si algo falta o la página está
 * rotada, no hay posiciones: el resaltado queda solo sobre el texto, nunca se inventa.
 */

/** Caja en fracciones de la página (0 a 1), origen arriba a la izquierda. */
export type Box = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/** Texto de la página y la caja de cada carácter, alineados por posición. */
export const PageLayoutSchema = z.strictObject({
  /** Los caracteres de la capa de texto, en orden. */
  text: z.string().max(200_000),
  /** Cuatro números por carácter: x0, y0, x1, y1 en fracciones; ceros si no tiene caja. */
  boxes: z.array(z.number().min(0).max(1)),
});
export type PageLayout = z.infer<typeof PageLayoutSchema>;

type RawFunction = (...args: number[]) => number;

/** Función exportada por el WebAssembly, verificada: existe y devuelve un número. */
function rawFunction(wasm: object, name: string): RawFunction | null {
  const fn: unknown = Reflect.get(wasm, name);
  if (typeof fn !== "function") return null;
  return (...args: number[]) => {
    const result: unknown = Reflect.apply(fn, wasm, args);
    if (typeof result !== "number") throw new TypeError(`${name} no devolvió un número`);
    return result;
  };
}

type RawProcedure = (...args: number[]) => void;

/** Procedimiento exportado (sin valor de retorno), verificado: existe. */
function rawProcedure(wasm: object, name: string): RawProcedure | null {
  const fn: unknown = Reflect.get(wasm, name);
  if (typeof fn !== "function") return null;
  return (...args: number[]) => {
    Reflect.apply(fn, wasm, args);
  };
}

type Pdfium = {
  readonly loadPage: RawFunction;
  readonly closePage: RawProcedure;
  readonly pageWidth: RawFunction;
  readonly pageHeight: RawFunction;
  readonly pageRotation: RawFunction;
  readonly loadTextPage: RawFunction;
  readonly closeTextPage: RawProcedure;
  readonly countChars: RawFunction;
  readonly unicodeAt: RawFunction;
  readonly charBox: RawFunction;
  readonly malloc: RawFunction;
  readonly free: RawProcedure;
  readonly heap: () => ArrayBuffer;
};

/** La puerta a PDFium a partir del documento abierto por clawpdf, o null si no se puede. */
function pdfiumOf(pdf: PdfDocument): { readonly pdfium: Pdfium; readonly document: number } | null {
  const engine: unknown = Reflect.get(pdf, "engine");
  const document: unknown = Reflect.get(pdf, "documentHandle");
  if (typeof engine !== "object" || engine === null || typeof document !== "number") return null;
  const wasm: unknown = Reflect.get(engine, "module");
  if (typeof wasm !== "object" || wasm === null) return null;
  const exportsObject: unknown = Reflect.get(wasm, "wasmExports");
  if (typeof exportsObject !== "object" || exportsObject === null) return null;

  const fns = {
    loadPage: rawFunction(wasm, "_FPDF_LoadPage"),
    closePage: rawProcedure(wasm, "_FPDF_ClosePage"),
    pageWidth: rawFunction(wasm, "_FPDF_GetPageWidth"),
    pageHeight: rawFunction(wasm, "_FPDF_GetPageHeight"),
    pageRotation: rawFunction(wasm, "_FPDFPage_GetRotation"),
    loadTextPage: rawFunction(wasm, "_FPDFText_LoadPage"),
    closeTextPage: rawProcedure(wasm, "_FPDFText_ClosePage"),
    countChars: rawFunction(wasm, "_FPDFText_CountChars"),
    unicodeAt: rawFunction(wasm, "_FPDFText_GetUnicode"),
    charBox: rawFunction(wasm, "_FPDFText_GetCharBox"),
    malloc: rawFunction(exportsObject, "malloc"),
    free: rawProcedure(exportsObject, "free"),
  };
  const heap = () => {
    const view: unknown = Reflect.get(wasm, "HEAPU8");
    if (!(view instanceof Uint8Array) || !(view.buffer instanceof ArrayBuffer)) {
      throw new TypeError("PDFium no expone su memoria");
    }
    return view.buffer;
  };
  const {
    loadPage,
    closePage,
    pageWidth,
    pageHeight,
    pageRotation,
    loadTextPage,
    closeTextPage,
    countChars,
    unicodeAt,
    charBox,
    malloc,
    free,
  } = fns;
  if (
    !loadPage ||
    !closePage ||
    !pageWidth ||
    !pageHeight ||
    !pageRotation ||
    !loadTextPage ||
    !closeTextPage ||
    !countChars ||
    !unicodeAt ||
    !charBox ||
    !malloc ||
    !free
  ) {
    return null;
  }
  return {
    document,
    pdfium: {
      loadPage,
      closePage,
      pageWidth,
      pageHeight,
      pageRotation,
      loadTextPage,
      closeTextPage,
      countChars,
      unicodeAt,
      charBox,
      malloc,
      free,
      heap,
    },
  };
}

const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;

/**
 * Texto y cajas de una página (base 1), o null si PDFium no da posiciones confiables.
 * Debe llamarse con el documento abierto; no lo cierra.
 */
export function readPageLayout(pdf: PdfDocument, pageNumber: number): PageLayout | null {
  const gate = pdfiumOf(pdf);
  if (!gate) return null;
  const { pdfium, document } = gate;
  const page = pdfium.loadPage(document, pageNumber - 1);
  if (!page) return null;
  try {
    // En una página rotada las cajas no coinciden con la imagen: mejor sin posiciones.
    if (pdfium.pageRotation(page) !== 0) return null;
    const width = pdfium.pageWidth(page);
    const height = pdfium.pageHeight(page);
    if (!(width > 0) || !(height > 0)) return null;
    const textPage = pdfium.loadTextPage(page);
    if (!textPage) return null;
    // Cuatro dobles de 8 bytes para izquierda, derecha, abajo y arriba.
    const out = pdfium.malloc(32);
    try {
      const count = pdfium.countChars(textPage);
      let text = "";
      const boxes: number[] = [];
      for (let i = 0; i < count; i++) {
        text += String.fromCodePoint(pdfium.unicodeAt(textPage, i) || 0x20);
        if (pdfium.charBox(textPage, i, out, out + 8, out + 16, out + 24)) {
          const [left = 0, right = 0, bottom = 0, top = 0] = new Float64Array(
            pdfium.heap(),
            out,
            4,
          );
          // PDFium mide desde abajo a la izquierda en puntos; la imagen, desde arriba.
          boxes.push(
            round(left / width),
            round(1 - top / height),
            round(right / width),
            round(1 - bottom / height),
          );
        } else {
          boxes.push(0, 0, 0, 0);
        }
      }
      return { text, boxes };
    } finally {
      pdfium.free(out);
      pdfium.closeTextPage(textPage);
    }
  } finally {
    pdfium.closePage(page);
  }
}

/** Texto compactado (cada tramo de espacios cuenta como uno) y de qué carácter viene cada uno. */
function compactText(layout: PageLayout): {
  readonly text: string;
  readonly origin: readonly number[];
} {
  const compact: string[] = [];
  const origin: number[] = [];
  let lastWasSpace = true;
  for (const [i, ch] of Array.from(layout.text).entries()) {
    const space = /\s/.test(ch);
    if (space && lastWasSpace) continue;
    compact.push(space ? " " : ch);
    origin.push(i);
    lastWasSpace = space;
  }
  return { text: compact.join(""), origin };
}

/** Busca `needle` en `haystack` desde `from`: primero tal cual, después sin mayúsculas. */
function find(haystack: string, needle: string, from = 0): number {
  const exact = haystack.indexOf(needle, from);
  return exact >= 0 ? exact : haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

/** Unión de las cajas de los caracteres compactados entre `start` y `end`. */
function unionBox(
  layout: PageLayout,
  origin: readonly number[],
  start: number,
  end: number,
): Box | null {
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (let k = start; k < end; k++) {
    const i = origin[k];
    if (i === undefined) continue;
    const [a = 0, b = 0, c = 0, d = 0] = layout.boxes.slice(i * 4, i * 4 + 4);
    if (c <= a || d <= b) continue; // carácter sin caja (espacio, salto)
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  }
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: round(x1 - x0), h: round(y1 - y0) };
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Caja de la evidencia de un campo: se ubica la cita completa (`quote`, por ejemplo
 * "TOTAL: 4.800.000,00") y dentro de ella el valor (`literal`). Así un valor que aparece dos
 * veces (subtotal igual al total) se ubica donde el Lector lo leyó, no en la primera
 * aparición. Si la cita no está, se intenta con el valor solo. Null si nada aparece.
 */
export function locateEvidence(layout: PageLayout, quote: string, literal: string): Box | null {
  const { text, origin } = compactText(layout);
  const needle = squash(literal);
  if (needle === "") return null;
  const context = squash(quote);
  const at = context === "" ? -1 : find(text, context);
  if (at >= 0) {
    const inner = find(text.slice(at, at + context.length), needle);
    if (inner >= 0) return unionBox(layout, origin, at + inner, at + inner + needle.length);
  }
  const alone = find(text, needle);
  return alone < 0 ? null : unionBox(layout, origin, alone, alone + needle.length);
}

/**
 * Caja de una cita en la página: la unión de las cajas de sus caracteres. La búsqueda ignora
 * diferencias de espacios y saltos de línea (como el Verificador) y, si no la encuentra
 * igual, sin distinguir mayúsculas. Null si la cita no está en la página.
 */
export function locateQuote(layout: PageLayout, quote: string): Box | null {
  return locateEvidence(layout, "", quote);
}
