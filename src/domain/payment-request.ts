import { z } from "zod";

import { CURRENCY_SPECS, CurrencySchema, type Currency } from "./currency";
import type { ExtractedFieldName } from "./extraction";
import { toSafeNumber } from "./money";

/**
 * Solicitud de pago de otro agente por la API de decisión (D32): los datos de la factura que
 * ese agente quiere pagar, ya separados en campos. Es contenido no confiable, como cualquier
 * factura: Yunque la convierte en un documento y la decide por el mismo camino.
 *
 * El contrato va en inglés. Los montos llegan como texto decimal con punto ("1200.00"),
 * nunca como número: un número de punto flotante no representa centavos exactos.
 */

/**
 * Lo que la fuente del documento dibuja: ASCII visible y el latín de Europa occidental y
 * central (tildes, eñe, cedilla). Un carácter fuera de ahí desaparece del PDF sin aviso: la
 * persona que aprueba no vería lo que mandó el agente, y la cita ya no estaría en el texto.
 * Fuera quedan los controles, el guion suave y el espacio duro, que tampoco se ven.
 */
const chars = (from: number, to: number) =>
  `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
const PRINTABLE = new RegExp(`^[${chars(0x20, 0x7e)}${chars(0xa1, 0xac)}${chars(0xae, 0x17f)}]+$`);

/**
 * Una palabra más larga que esto se corta a mitad de línea en el PDF, y el corte separa la
 * cita del texto: la solicitud escalaría sin motivo.
 */
const MAX_WORD = 60;

/** Texto de una línea que el documento muestra y cita tal como llegó. */
function line(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(PRINTABLE, {
      error: "Solo letras latinas, números y signos comunes, sin saltos de línea",
    })
    .refine((text) => text.split(" ").every((word) => word.length <= MAX_WORD), {
      error: `Ninguna palabra puede pasar de ${String(MAX_WORD)} caracteres`,
    });
}

const DecimalAmount = z.string().regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,2})?$/, {
  error: 'Monto decimal con punto y hasta dos decimales, por ejemplo "1200.00"',
});

export const PaymentRequestSchema = z.strictObject({
  /** Identidad de la solicitud: repetirla devuelve la misma decisión. */
  idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/, {
    error: "Entre 1 y 120 letras, números, punto, guion, guion bajo o dos puntos",
  }),
  payee_name: line(200),
  invoice_number: line(MAX_WORD),
  currency: CurrencySchema,
  total: DecimalAmount.refine((v) => /[1-9]/.test(v), {
    error: "El total debe ser mayor que cero",
  }),
  payee_tax_id: line(50).optional(),
  issue_date: z.iso.date().optional(),
  due_date: z.iso.date().optional(),
  subtotal: DecimalAmount.optional(),
  taxes: DecimalAmount.optional(),
  bank_account: line(64).min(4).optional(),
  bank_holder: line(200).optional(),
  purchase_order: line(50).optional(),
  hours: z.number().int().min(0).max(10_000).optional(),
  description: line(500).optional(),
});
export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

/** Una línea del documento de la solicitud: el campo que respalda, su rótulo y su valor. */
export type PaymentRequestLine = {
  readonly field: ExtractedFieldName;
  readonly label: string;
  /** El valor tal como queda escrito en el documento: es la literal de su evidencia. */
  readonly literal: string;
  /** El valor normalizado que lleva la extracción. */
  readonly value: string | number;
};

/** Monto decimal a unidad mínima, en enteros: "1200.5" USD → 120050. */
export function minorUnits(amount: string, currency: Currency): number {
  const [whole = "0", fraction = ""] = amount.split(".");
  const digits = CURRENCY_SPECS[currency].minorDigits;
  return toSafeNumber(BigInt(whole + fraction.padEnd(digits, "0").slice(0, digits)));
}

/** Unidad mínima a decimal con todos sus dígitos: 120050 USD → "1200.50". */
export function decimalText(minor: number, currency: Currency): string {
  const digits = CURRENCY_SPECS[currency].minorDigits;
  const text = String(minor).padStart(digits + 1, "0");
  return digits > 0 ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
}

/**
 * Las líneas del documento, en orden de lectura. Cada campo presente da una línea
 * `Rótulo: valor`; los montos se escriben normalizados para que su literal se lea igual que
 * su valor. Un campo ausente no da línea.
 */
export function paymentRequestLines(request: PaymentRequest): readonly PaymentRequestLine[] {
  const { currency } = request;
  const amount = (field: ExtractedFieldName, label: string, text: string | undefined) => {
    if (text === undefined) return [];
    const value = minorUnits(text, currency);
    return [{ field, label, literal: decimalText(value, currency), value }];
  };
  const plain = (field: ExtractedFieldName, label: string, text: string | undefined) =>
    text === undefined ? [] : [{ field, label, literal: text, value: text }];
  return [
    ...plain("payee_name", "Beneficiario", request.payee_name),
    ...plain("payee_tax_id", "Identificación", request.payee_tax_id),
    ...plain("invoice_number", "Número", request.invoice_number),
    ...plain("purchase_order", "Orden de compra", request.purchase_order),
    ...plain("issue_date", "Emisión", request.issue_date),
    ...plain("due_date", "Vencimiento", request.due_date),
    ...plain("currency", "Moneda", currency),
    ...amount("subtotal", "Subtotal", request.subtotal),
    ...amount("taxes", "Impuestos", request.taxes),
    ...amount("total", "Total", request.total),
    ...(request.hours === undefined
      ? []
      : [
          {
            field: "hours" as const,
            label: "Horas",
            literal: String(request.hours),
            value: request.hours,
          },
        ]),
    ...plain("bank_account", "Cuenta", request.bank_account),
    ...plain("bank_holder", "Titular", request.bank_holder),
    ...plain("description", "Concepto", request.description),
  ];
}
