import { z } from "zod";

import type { CaseDocument } from "@/src/dataset/schema";
import type { Database } from "@/src/db/client";
import { listVendors } from "@/src/db/repositories";
import {
  CurrencySchema,
  DecimalAmountSchema,
  UlidSchema,
  decimalText,
  maskAccount,
  minorUnits,
  printableLine,
  type Currency,
  type Ulid,
  type Vendor,
} from "@/src/domain";

import { UseCaseError } from "./errors";

/**
 * Arma tu propia factura (docs/roadmap.md, nivel 4): el cliente elige proveedor, monto,
 * cuenta y una nota, y Yunque pinta la factura con la plantilla del dataset que corresponde
 * a su moneda. Después entra como una subida: la lee el Lector y la decide el motor, igual
 * que una factura real. Así el cliente ve pagar, frenar y escalar con datos que eligió él.
 *
 * Aquí solo se compone el documento. Nada de lo que elige el cliente cambia reglas, vendors
 * ni saldos: es una factura más, con todo su contenido no confiable.
 */

/** Lo que el formulario necesita de cada proveedor registrado, con los valores que cuadran. */
export type BuilderVendor = {
  readonly id: Ulid;
  readonly name: string;
  readonly currency: Currency;
  readonly accountMasked: string;
  /** Total que cuadra con su acuerdo, en decimal: con él la factura se puede pagar. */
  readonly suggestedTotal: string | null;
  /** Horas acordadas si cobra por hora; el monto sale de tarifa por horas. */
  readonly hours: number | null;
  /** Tarifa por hora en decimal, para recalcular el total al cambiar las horas. */
  readonly hourlyRate: string | null;
};

export async function loadInvoiceBuilder(
  db: Database,
  organizationId: Ulid,
): Promise<BuilderVendor[]> {
  const vendors = await listVendors(db, organizationId);
  return vendors.map((v) => {
    const { currency } = v.account;
    const a = v.agreement;
    const open = a.kind === "purchase_orders" ? a.orders.find((o) => o.open) : undefined;
    const suggested =
      a.kind === "recurring"
        ? a.expected.amount
        : a.kind === "hourly"
          ? a.rate.amount * a.hours_per_period
          : (open?.amount.amount ?? null);
    return {
      id: v.id,
      name: v.name,
      currency,
      accountMasked: maskAccount(v.account.account_number),
      suggestedTotal: suggested === null ? null : decimalText(suggested, currency),
      hours: a.kind === "hourly" ? a.hours_per_period : null,
      hourlyRate: a.kind === "hourly" ? decimalText(a.rate.amount, currency) : null,
    };
  });
}

export const InvoiceChoiceSchema = z.strictObject({
  vendor: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("registrado"), id: UlidSchema }),
    z.strictObject({
      kind: z.literal("nuevo"),
      name: printableLine(120),
      currency: CurrencySchema,
    }),
  ]),
  total: DecimalAmountSchema.refine((v) => /[1-9]/.test(v), {
    error: "El total debe ser mayor que cero",
  }),
  hours: z.number().int().min(1).max(1000).nullable(),
  /** La cuenta registrada del proveedor, u otra: el fraude más común. */
  account: z.enum(["registrada", "otra"]),
  description: printableLine(200),
  /** Texto que la factura muestra además, por ejemplo una instrucción para el agente. */
  note: printableLine(300).nullable(),
  /** Pintar la nota en blanco: invisible a la vista, presente en el texto del PDF. */
  hiddenNote: z.boolean(),
});
export type InvoiceChoice = z.infer<typeof InvoiceChoiceSchema>;

/**
 * Plantilla del dataset por moneda, con el impuesto que su rótulo imprime («IVA 19 %»). El
 * total se reparte en subtotal e impuesto con esa tasa: una factura que diga «IVA 19 %: 0,00»
 * es incoherente, y el Lector la marcaría ambigua con razón. Null: la plantilla no lleva
 * impuesto ni subtotal.
 */
const TEMPLATE_BY_CURRENCY: Readonly<
  Record<Currency, { readonly id: string; readonly taxPercent: number | null }>
> = {
  COP: { id: "factura_co", taxPercent: 19 },
  MXN: { id: "nota_cobro_mx", taxPercent: 16 },
  EUR: { id: "factura_eu", taxPercent: 0 },
  USD: { id: "invoice_en", taxPercent: null },
  BRL: { id: "invoice_en", taxPercent: null },
  ARS: { id: "invoice_en", taxPercent: null },
};

/** Subtotal e impuesto que suman el total, redondeando el subtotal a la unidad mínima. */
function splitTax(
  total: number,
  taxPercent: number | null,
): { readonly subtotal: number | null; readonly taxes: number | null } {
  if (taxPercent === null) return { subtotal: null, taxes: null };
  const scaled = BigInt(total) * 200n;
  const subtotal = Number((scaled / BigInt(100 + taxPercent) + 1n) / 2n);
  return { subtotal, taxes: total - subtotal };
}

/** Días hasta el vencimiento: dentro de lo normal, así la factura no escala por vencida. */
const DUE_IN_DAYS = 15;

/** Fuente de azar inyectada: número de factura y datos inventados de un proveedor nuevo. */
export type Random = () => number;

function digits(random: Random, count: number): string {
  return Array.from({ length: count }, () => String(Math.floor(random() * 10))).join("");
}

/**
 * Otra cuenta, parecida a la registrada: los últimos cuatro dígitos cambian. Es como se ve
 * un cambio de cuenta fraudulento, a primera vista igual.
 */
export function otherAccount(account: string): string {
  const head = account.slice(0, -4);
  const tail = [...account.slice(-4)]
    .map((c) => (/[0-9]/.test(c) ? String((Number(c) + 5) % 10) : c))
    .join("");
  return head + tail;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** El documento a pintar y la plantilla que le corresponde. */
export async function composeInvoice(
  db: Database,
  input: {
    readonly organizationId: Ulid;
    readonly choice: InvoiceChoice;
    /** Día de negocio de la demo: emisión hoy, vencimiento en `DUE_IN_DAYS`. */
    readonly today: string;
    readonly random: Random;
  },
): Promise<{ readonly templateId: string; readonly document: CaseDocument }> {
  const { choice, random } = input;
  const { vendor, name, currency } = await payeeOf(db, input.organizationId, choice.vendor);
  const total = minorUnits(choice.total, currency);
  const registeredAccount = vendor?.account.account_number ?? null;
  const account =
    registeredAccount === null
      ? digits(random, 11)
      : choice.account === "otra"
        ? otherAccount(registeredAccount)
        : registeredAccount;
  const note = choice.note;
  const template = TEMPLATE_BY_CURRENCY[currency];
  const { subtotal, taxes } = splitTax(total, template.taxPercent);
  return {
    templateId: template.id,
    document: {
      vendor_key: null,
      payee_name: name,
      payee_tax_id: vendor ? (vendor.tax_id ?? null) : `${digits(random, 9)}-${digits(random, 1)}`,
      invoice_number: `FA-${digits(random, 5)}`,
      issue_date: input.today,
      due_date: addDays(input.today, DUE_IN_DAYS),
      currency,
      subtotal,
      taxes,
      total,
      total_in_words: null,
      bank_account: account,
      bank_holder: vendor ? vendor.account.holder_name : name,
      hours: choice.hours,
      purchase_order:
        vendor?.agreement.kind === "purchase_orders"
          ? (vendor.agreement.orders.find((o) => o.open)?.number ?? null)
          : null,
      description: choice.description,
      extra: note !== null && !choice.hiddenNote ? note : null,
      hidden_text: note !== null && choice.hiddenNote ? note : null,
    },
  };
}

/** A quién se le cobra: un proveedor registrado de la empresa, o uno nuevo con su nombre. */
async function payeeOf(
  db: Database,
  organizationId: Ulid,
  choice: InvoiceChoice["vendor"],
): Promise<{ readonly vendor: Vendor | null; readonly name: string; readonly currency: Currency }> {
  if (choice.kind === "nuevo")
    return { vendor: null, name: choice.name, currency: choice.currency };
  const found = (await listVendors(db, organizationId)).find((v) => v.id === choice.id);
  if (!found) {
    throw new UseCaseError("rejected_document", "Ese proveedor no está registrado en tu empresa", {
      action: "Elige un proveedor de la lista o uno nuevo",
      severity: "warning",
    });
  }
  return { vendor: found, name: found.name, currency: found.account.currency };
}
