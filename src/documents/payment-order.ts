import { getDefaultFont, type Template } from "@pdfme/common";
import { generate } from "@pdfme/generator";
import { PDFDocument } from "@pdfme/pdf-lib";
import { barcodes, line, text } from "@pdfme/schemas";

import {
  formatMoney,
  jsonHash,
  type PaymentOrderDraft,
  type Sha256,
  type Ulid,
} from "@/src/domain";
import { auditInstant, calendarDate } from "@/src/ui/format";

/**
 * Orden de pago en PDF (docs/plan.md paso 27): una página con beneficiario, cuenta, monto,
 * riel, referencia, versión de política, hashes y un código QR. Se arma solo con lo que la
 * decisión registró, que sale del vendor dado de alta y nunca del texto leído de la factura.
 * No necesita el PDF original ni ejecuta nada: es el papel que acompaña una orden preparada.
 *
 * El PDF es determinista: los metadatos usan la fecha de la decisión, así la misma orden
 * produce siempre los mismos bytes.
 */

export type PaymentOrderSheet = {
  readonly organizationName: string;
  readonly invoiceReference: string;
  readonly decisionId: Ulid;
  readonly order: PaymentOrderDraft;
  readonly decidedAt: string;
  /** "el agente" o el nombre de quien aprobó. */
  readonly decidedBy: string;
  readonly policyVersion: number;
  readonly policyHash: Sha256;
  readonly documentHash: Sha256;
};

/** Huella de la orden: lo que el QR permite verificar contra la base. */
export function paymentOrderHash(sheet: PaymentOrderSheet): Sha256 {
  return jsonHash({
    decision_id: sheet.decisionId,
    order: sheet.order,
    policy_hash: sheet.policyHash,
    document_hash: sheet.documentHash,
  });
}

/** Contenido del QR: identifica la decisión y la huella de la orden. */
export function paymentOrderQr(sheet: PaymentOrderSheet): string {
  return `yunque:orden:v1:${sheet.decisionId}:${paymentOrderHash(sheet)}`;
}

type Schema = Template["schemas"][number][number];

const INK = "#1a2233";
const INK_SOFT = "#4b5468";
const PAGE = { width: 210, height: 297 };
const MARGIN = 20;
const LABEL_WIDTH = 48;
const ROW_HEIGHT = 9;

function textBox(
  name: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
  fontSize: number,
  color: string = INK,
): Schema {
  return {
    name,
    type: "text",
    position,
    width: size.width,
    height: size.height,
    fontSize,
    fontColor: color,
    lineHeight: 1.2,
  };
}

/** Filas de la orden: etiqueta y valor, en el orden en que se leen. */
function rows(sheet: PaymentOrderSheet): readonly (readonly [string, string])[] {
  const { order } = sheet;
  return [
    ["Referencia", order.reference],
    ["Beneficiario", order.beneficiary_name],
    ["Cuenta destino", `${order.account_masked} · ${order.rail}`],
    ["Monto", formatMoney(order.amount)],
    ["Programada para", calendarDate(order.scheduled_for)],
    ["Cuenta origen", order.source_account_id],
    ["Decidida por", `${sheet.decidedBy} · ${auditInstant(sheet.decidedAt)} (hora de Bogotá)`],
    ["Política", `v${String(sheet.policyVersion)} · ${sheet.policyHash}`],
    ["Documento", sheet.documentHash],
    ["Huella de la orden", paymentOrderHash(sheet)],
  ];
}

export function paymentOrderTemplate(sheet: PaymentOrderSheet): {
  readonly template: Template;
  readonly inputs: Record<string, string>;
} {
  const contentWidth = PAGE.width - 2 * MARGIN;
  const schemas: Schema[] = [
    textBox("title", { x: MARGIN, y: MARGIN }, { width: 120, height: 10 }, 20),
    textBox("status", { x: MARGIN, y: MARGIN + 11 }, { width: 120, height: 6 }, 10, INK_SOFT),
    textBox("company", { x: MARGIN, y: MARGIN + 17 }, { width: 120, height: 6 }, 10, INK_SOFT),
    {
      name: "qr",
      type: "qrcode",
      position: { x: PAGE.width - MARGIN - 34, y: MARGIN },
      width: 34,
      height: 34,
      backgroundColor: "#ffffff",
      barColor: INK,
    },
    {
      name: "rule",
      type: "line",
      position: { x: MARGIN, y: MARGIN + 40 },
      width: contentWidth,
      height: 0.3,
      color: "#c9c6bd",
    },
  ];
  const inputs: Record<string, string> = {
    title: "Orden de pago",
    status: "Preparada, no ejecutada",
    company: `${sheet.organizationName} · factura ${sheet.invoiceReference}`,
    qr: paymentOrderQr(sheet),
  };
  rows(sheet).forEach(([label, value], i) => {
    const y = MARGIN + 46 + i * ROW_HEIGHT;
    schemas.push(
      textBox(
        `label_${String(i)}`,
        { x: MARGIN, y },
        { width: LABEL_WIDTH, height: 6 },
        9,
        INK_SOFT,
      ),
      textBox(
        `value_${String(i)}`,
        { x: MARGIN + LABEL_WIDTH, y },
        { width: contentWidth - LABEL_WIDTH, height: 8 },
        // Los hashes son largos: van más chicos para caber en una línea.
        value.length > 60 ? 7 : 10,
      ),
    );
    inputs[`label_${String(i)}`] = label;
    inputs[`value_${String(i)}`] = value;
  });
  schemas.push(
    textBox(
      "footer",
      { x: MARGIN, y: PAGE.height - MARGIN - 14 },
      { width: contentWidth, height: 14 },
      8,
      INK_SOFT,
    ),
  );
  inputs["footer"] =
    "Esta orden se arma con los datos registrados del beneficiario, no con el texto de la factura. " +
    "No ejecuta ningún pago. El código QR identifica la decisión y la huella de la orden.";
  return {
    template: { basePdf: { ...PAGE, padding: [0, 0, 0, 0] }, schemas: [schemas] },
    inputs,
  };
}

export async function renderPaymentOrder(sheet: PaymentOrderSheet): Promise<Uint8Array> {
  const { template, inputs } = paymentOrderTemplate(sheet);
  const generated = await generate({
    template,
    inputs: [inputs],
    plugins: { text, line, qrcode: barcodes.qrcode },
    options: { font: getDefaultFont() },
  });
  const pdf = await PDFDocument.load(generated, { updateMetadata: false });
  const at = new Date(sheet.decidedAt);
  pdf.setCreationDate(at);
  pdf.setModificationDate(at);
  pdf.setProducer("Yunque");
  pdf.setCreator("Yunque");
  pdf.setTitle(`Orden de pago ${sheet.order.reference}`);
  return pdf.save({ useObjectStreams: false });
}
