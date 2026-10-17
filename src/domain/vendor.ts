import { z } from "zod";

import {
  CURRENCY_SPECS,
  CountrySchema,
  CurrencySchema,
  RailSchema,
  railSupportsCurrency,
} from "./currency";
import { UlidSchema } from "./ids";
import { PositiveMoneySchema } from "./money";

/**
 * Vendor: beneficiario permitido. Sus datos de pago son la única fuente para la orden
 * de pago (invariante 10). Nada de aquí sale del texto del modelo.
 */

/**
 * Cuenta ficticia. Se guarda completa; la pantalla muestra solo los últimos cuatro.
 * La ruta debe servir para la moneda, y la moneda pertenece a la región de la cuenta.
 */
export const BankAccountSchema = z
  .strictObject({
    country: CountrySchema,
    currency: CurrencySchema,
    rail: RailSchema,
    /** Número de cuenta, CBU, CLABE o IBAN: solo dígitos y letras, 4 a 34 caracteres. */
    account_number: z.string().regex(/^[A-Za-z0-9]{4,34}$/),
    /** Código de banco, routing, SWIFT o similar. Opcional según la ruta. */
    bank_code: z
      .string()
      .regex(/^[A-Za-z0-9]{2,20}$/)
      .optional(),
    holder_name: z.string().min(1).max(200),
    /** Documento del titular (NIT, RFC, CUIT, CNPJ, EIN). Opcional. */
    holder_tax_id: z.string().min(1).max(50).optional(),
  })
  .refine((a) => railSupportsCurrency(a.rail, a.currency), {
    path: ["rail"],
    error: "La ruta no sirve para pagar en esa moneda",
  })
  .refine((a) => CURRENCY_SPECS[a.currency].country === a.country, {
    path: ["country"],
    error: "La moneda no corresponde a la región de la cuenta",
  });
export type BankAccount = Readonly<z.infer<typeof BankAccountSchema>>;

export const VerificationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pendiente") }),
  z.strictObject({
    status: z.literal("verificado"),
    by: z.string().min(1).max(200),
    at: z.iso.datetime(),
  }),
]);
export type Verification = z.infer<typeof VerificationSchema>;

/** Qué se le acordó al vendor; contra esto cuadra `amount_mismatch`. */
export const AgreementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("recurring"),
    expected: PositiveMoneySchema,
    period: z.enum(["month", "week", "year"]),
  }),
  z.strictObject({
    kind: z.literal("hourly"),
    rate: PositiveMoneySchema,
    /** Horas acordadas por periodo. La factura reporta horas; monto esperado = tarifa × horas. */
    hours_per_period: z.number().int().positive().max(1000),
    period: z.enum(["month", "week"]),
  }),
  z.strictObject({
    kind: z.literal("purchase_orders"),
    orders: z
      .array(
        z.strictObject({
          number: z.string().min(1).max(50),
          amount: PositiveMoneySchema,
          open: z.boolean(),
        }),
      )
      .max(500),
  }),
  z.strictObject({ kind: z.literal("none") }),
]);
export type Agreement = z.infer<typeof AgreementSchema>;

export const VendorSchema = z
  .strictObject({
    id: UlidSchema,
    organization_id: UlidSchema,
    name: z.string().min(1).max(200),
    aliases: z.array(z.string().min(1).max(200)).max(20),
    tax_id: z.string().min(1).max(50).optional(),
    /** Región del vendor. Debe coincidir con la de su cuenta. */
    country: CountrySchema,
    account: BankAccountSchema,
    verification: VerificationSchema,
    agreement: AgreementSchema,
    created_at: z.iso.datetime(),
  })
  .refine((v) => v.country === v.account.country, {
    path: ["country"],
    error: "La región del vendor debe coincidir con la de su cuenta",
  });
export type Vendor = Readonly<z.infer<typeof VendorSchema>>;

/** Últimos cuatro caracteres, para pantalla y bitácora. */
export function maskAccount(accountNumber: string): string {
  return `****${accountNumber.slice(-4)}`;
}
