import { getDefaultFont, type Template } from "@pdfme/common";
import { generate } from "@pdfme/generator";
import { PDFDocument } from "@pdfme/pdf-lib";
import { text } from "@pdfme/schemas";

import type { PaymentRequestLine } from "@/src/domain";

/**
 * Documento de una solicitud de pago por la API (D32): una página con una línea
 * `Rótulo: valor` por campo. Es lo que el lector de la solicitud cita y lo que una persona
 * ve en el acta, así sabe exactamente qué pidió el agente.
 *
 * Determinista: los mismos campos dan los mismos bytes. Dos solicitudes iguales con otra
 * llave de idempotencia son el mismo documento, y el motor las frena como duplicado.
 */

type Schema = Template["schemas"][number][number];

const INK = "#1a2233";
const INK_SOFT = "#4b5468";
const PAGE = { width: 210, height: 297 };
const MARGIN = 20;
/** Alto de una línea de texto a 10 pt con interlineado 1,2, y aire entre filas, en mm. */
const LINE_MM = 4.3;
const ROW_GAP_MM = 4;
/**
 * Caracteres que caben en una línea del ancho útil a 10 pt, con margen: un texto largo baja a
 * la línea siguiente y su caja crece con él, así no se encima con la fila de abajo.
 */
const CHARS_PER_LINE = 80;
/** Fecha fija de los metadatos: la del documento no depende de cuándo llegó. */
const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

function textBox(
  name: string,
  y: number,
  height: number,
  fontSize: number,
  color: string = INK,
): Schema {
  return {
    name,
    type: "text",
    position: { x: MARGIN, y },
    width: PAGE.width - 2 * MARGIN,
    height,
    fontSize,
    fontColor: color,
    lineHeight: 1.2,
  };
}

export function paymentRequestTemplate(lines: readonly PaymentRequestLine[]): {
  readonly template: Template;
  readonly inputs: Record<string, string>;
} {
  const schemas: Schema[] = [
    textBox("title", MARGIN, 10, 20),
    textBox("origin", MARGIN + 11, 6, 10, INK_SOFT),
  ];
  const inputs: Record<string, string> = {
    title: "Solicitud de pago",
    origin: "Enviada por otro agente a la API de decisión de Yunque",
  };
  let y = MARGIN + 26;
  lines.forEach((line, i) => {
    const name = `line_${String(i)}`;
    // Rótulo y valor en la misma caja: el texto del PDF los conserva juntos, y esa es la cita.
    const content = `${line.label}: ${line.literal}`;
    const height = Math.ceil(content.length / CHARS_PER_LINE) * LINE_MM;
    schemas.push(textBox(name, y, height, 10));
    inputs[name] = content;
    y += height + ROW_GAP_MM;
  });
  return {
    template: { basePdf: { ...PAGE, padding: [0, 0, 0, 0] }, schemas: [schemas] },
    inputs,
  };
}

export async function renderPaymentRequest(
  lines: readonly PaymentRequestLine[],
): Promise<Uint8Array> {
  const { template, inputs } = paymentRequestTemplate(lines);
  const generated = await generate({
    template,
    inputs: [inputs],
    plugins: { text },
    options: { font: getDefaultFont() },
  });
  const pdf = await PDFDocument.load(generated, { updateMetadata: false });
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  pdf.setProducer("Yunque");
  pdf.setCreator("Yunque");
  pdf.setTitle("Solicitud de pago");
  return pdf.save({ useObjectStreams: false });
}
