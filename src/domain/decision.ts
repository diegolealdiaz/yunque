import { z } from "zod";

import { RailSchema } from "./currency";
import { ExtractedFieldNameSchema, FieldSourceSchema } from "./extraction";
import { FindingSchema, hasBlocking } from "./finding";
import { Sha256Schema } from "./hash";
import { UlidSchema } from "./ids";
import { MoneySchema } from "./money";

/**
 * Decisión: inmutable. Cada reevaluación crea una decisión nueva que apunta a la anterior.
 * Contiene todo lo necesario para recomputar el veredicto sin red: hash del documento,
 * hash de la extracción, versión y hash de la política, hallazgos y actor.
 */

export const VerdictSchema = z.enum(["pagar", "frenar", "escalar"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("agente") }),
  z.strictObject({ kind: z.literal("humano"), name: z.string().min(1).max(200) }),
]);
export type Actor = z.infer<typeof ActorSchema>;

/**
 * Orden de pago en formato de la plataforma. Borrador: "preparada, no ejecutada".
 * Beneficiario y cuenta salen del vendor registrado, nunca del texto del documento.
 * La moneda es la de `amount`.
 */
export const PaymentOrderDraftSchema = z.strictObject({
  status: z.literal("preparada_no_ejecutada"),
  vendor_id: UlidSchema,
  beneficiary_name: z.string().min(1).max(200),
  amount: MoneySchema,
  rail: RailSchema,
  account_masked: z.string().regex(/^\*{4}[A-Za-z0-9]{1,4}$/),
  source_account_id: z.string().min(1).max(100),
  scheduled_for: z.iso.date(),
  reference: z.string().min(1).max(100),
});
export type PaymentOrderDraft = Readonly<z.infer<typeof PaymentOrderDraftSchema>>;

/**
 * Invariantes que el esquema fija en el borde:
 * - `pagar` exige cero hallazgos `block`, una orden de pago y una fecha programada igual
 *   a la de la orden (invariantes 1 y 10).
 * - `frenar` y `escalar` no llevan orden de pago.
 */
export const DecisionSchema = z
  .strictObject({
    id: UlidSchema,
    organization_id: UlidSchema,
    invoice_id: UlidSchema,
    verdict: VerdictSchema,
    findings: z.array(FindingSchema).max(100),
    /** Explicación por plantilla, siempre presente. */
    explanation: z.string().min(1).max(5000),
    /** Resumen en prosa del modelo, opcional. No altera el veredicto. */
    summary: z.string().max(2000).nullable(),
    scheduled_for: z.iso.date().nullable(),
    payment_order: PaymentOrderDraftSchema.nullable(),
    /** Monto evaluado en la moneda del documento y su equivalente en USD. */
    amount: MoneySchema.nullable(),
    amount_usd: MoneySchema.extend({ currency: z.literal("USD") }).nullable(),
    vendor_id: UlidSchema.nullable(),
    policy_version_id: UlidSchema,
    policy_hash: Sha256Schema,
    document_hash: Sha256Schema,
    extraction_hash: Sha256Schema.nullable(),
    /** Fuente de cada campo que alimentó la decisión: modelo o persona. */
    field_sources: z.partialRecord(ExtractedFieldNameSchema, FieldSourceSchema),
    previous_decision_id: UlidSchema.nullable(),
    /** Modo de prueba activo al decidir: la decisión se registra pero no compromete nada. */
    dry_run: z.boolean(),
    actor: ActorSchema,
    /** Costo y latencia de la lectura que alimentó esta decisión. */
    cost_usd_micros: z.number().int().min(0),
    latency_ms: z.number().int().min(0),
    decided_at: z.iso.datetime(),
  })
  .superRefine((d, ctx) => {
    if (d.verdict === "pagar") {
      if (hasBlocking(d.findings)) {
        ctx.addIssue({ code: "custom", path: ["verdict"], message: "pagar con un hallazgo block" });
      }
      if (d.payment_order === null) {
        ctx.addIssue({ code: "custom", path: ["payment_order"], message: "pagar exige una orden" });
      } else if (d.scheduled_for !== d.payment_order.scheduled_for) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduled_for"],
          message: "la fecha programada debe coincidir con la de la orden",
        });
      }
    } else if (d.payment_order !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["payment_order"],
        message: `${d.verdict} no lleva orden de pago`,
      });
    }
  });
export type Decision = Readonly<z.infer<typeof DecisionSchema>>;
