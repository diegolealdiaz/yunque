import { getDefaultFont, type Template } from "@pdfme/common";
import { generate } from "@pdfme/generator";
import { PDFDocument } from "@pdfme/pdf-lib";
import { text } from "@pdfme/schemas";
import { openPdf } from "clawpdf";

import { fieldLiteral } from "./format";
import type { CaseDocument, DocumentTemplate, TemplateFieldName } from "./schema";

/**
 * Convierte una plantilla y un documento en bytes: PDF con capa de texto, determinista
 * (fechas de creación fijas, sin identificadores aleatorios), y PNG "escaneado" a partir
 * del PDF, sin capa de texto.
 */

/** Fecha fija de los metadatos: dos corridas producen los mismos bytes. */
const FIXED_DATE = new Date("2026-10-01T00:00:00.000Z");
const PRODUCER = "Yunque dataset";
const HIDDEN_COLOR = "#ffffff";
const SCAN_DPI = 110;

export type PaintedField = {
  readonly name: TemplateFieldName;
  readonly literal: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type Schema = Template["schemas"][number][number];

function textSchema(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  color?: string,
): Schema {
  return {
    name,
    type: "text",
    position: { x, y },
    width,
    height,
    fontSize,
    fontColor: color ?? "#1a2233",
    lineHeight: 1.2,
  };
}

/** Arma la plantilla de pdfme y los valores a pintar. Devuelve también los campos pintados. */
export function layout(
  template: DocumentTemplate,
  doc: CaseDocument,
): { pdfmeTemplate: Template; inputs: Record<string, string>; fields: PaintedField[] } {
  const schemas: Schema[] = [];
  const inputs: Record<string, string> = {};
  const fields: PaintedField[] = [];

  template.labels.forEach((label, i) => {
    const key = `label_${String(i)}`;
    schemas.push(
      textSchema(key, label.x, label.y, label.width, label.height, label.fontSize, label.color),
    );
    inputs[key] = label.text;
  });

  for (const slot of template.fields) {
    const literal = fieldLiteral(doc, slot.name, template.locale);
    if (literal === null) continue;
    schemas.push(
      textSchema(slot.name, slot.x, slot.y, slot.width, slot.height, slot.fontSize, slot.color),
    );
    inputs[slot.name] = `${slot.prefix ?? ""}${literal}`;
    fields.push({
      name: slot.name,
      literal,
      page: 1,
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
    });
  }

  if (doc.hidden_text !== null) {
    schemas.push(
      textSchema(
        "hidden_text",
        20,
        template.page.height - 40,
        template.page.width - 40,
        16,
        7,
        HIDDEN_COLOR,
      ),
    );
    inputs["hidden_text"] = doc.hidden_text;
  }

  const pdfmeTemplate: Template = {
    basePdf: { width: template.page.width, height: template.page.height, padding: [0, 0, 0, 0] },
    schemas: [schemas],
  };
  return { pdfmeTemplate, inputs, fields };
}

/** Genera el PDF con metadatos fijos. */
export async function renderPdf(
  template: DocumentTemplate,
  doc: CaseDocument,
): Promise<{ bytes: Uint8Array; fields: PaintedField[] }> {
  const { pdfmeTemplate, inputs, fields } = layout(template, doc);
  const generated = await generate({
    template: pdfmeTemplate,
    inputs: [inputs],
    plugins: { text },
    options: { font: getDefaultFont() },
  });
  const pdf = await PDFDocument.load(generated, { updateMetadata: false });
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  pdf.setProducer(PRODUCER);
  pdf.setCreator(PRODUCER);
  pdf.setTitle(`${doc.payee_name} ${doc.invoice_number}`);
  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, fields };
}

/** Renderiza la primera página del PDF como PNG, sin capa de texto, como un escaneo. */
export async function renderScan(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await openPdf(pdfBytes);
  try {
    return await pdf.page(1).png({ dpi: SCAN_DPI, background: "white" });
  } finally {
    pdf.destroy();
  }
}

/** Texto de la capa del PDF, para comprobar que cada literal aparece. */
export async function pdfText(pdfBytes: Uint8Array): Promise<string> {
  const pdf = await openPdf(pdfBytes);
  try {
    return pdf.text();
  } finally {
    pdf.destroy();
  }
}
