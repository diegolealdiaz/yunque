import { z } from "zod";

import { Sha256Schema } from "./hash";
import { UlidSchema } from "./ids";
import { MoneySchema } from "./money";
import { FindingCodeSchema } from "./rules";

/**
 * Aprobación: resolución humana de un escalado. Firma el contenido exacto que se aprobó
 * (invariante 8): si el documento, el monto, el beneficiario, la cuenta o la política
 * cambian, la firma no coincide y la aprobación no vale. Una aprobación se consume una vez.
 */

/**
 * Lo que la persona firma. Se serializa canónicamente y se firma con HMAC. Monto, vendor y
 * cuenta pueden faltar solo en un rechazo (un beneficiario desconocido se rechaza, no se
 * paga); una aprobación los exige.
 */
export const ApprovalPayloadSchema = z.strictObject({
  invoice_id: UlidSchema,
  decision_id: UlidSchema,
  document_hash: Sha256Schema,
  amount: MoneySchema.nullable(),
  vendor_id: UlidSchema.nullable(),
  account_masked: z
    .string()
    .regex(/^\*{4}[A-Za-z0-9]{1,4}$/)
    .nullable(),
  policy_version_id: UlidSchema,
  policy_hash: Sha256Schema,
});
export type ApprovalPayload = Readonly<z.infer<typeof ApprovalPayloadSchema>>;

export const ChecklistItemSchema = z.strictObject({
  /** Código del hallazgo que originó la frase, o `general`. */
  code: FindingCodeSchema.or(z.literal("general")),
  text: z.string().min(1).max(500),
  checked: z.boolean(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ApprovalOutcomeSchema = z.enum(["aprobada", "rechazada"]);

export const ApprovalSchema = z
  .strictObject({
    id: UlidSchema,
    organization_id: UlidSchema,
    invoice_id: UlidSchema,
    decision_id: UlidSchema,
    outcome: ApprovalOutcomeSchema,
    approver: z.string().min(1).max(200),
    checklist: z.array(ChecklistItemSchema).max(50),
    reason: z.string().max(1000).nullable(),
    payload: ApprovalPayloadSchema,
    /** HMAC-SHA256 en hexadecimal sobre el JSON canónico del payload. */
    signature: Sha256Schema,
    /** Momento en que se consumió: una decisión posterior la usó. Null hasta entonces. */
    consumed_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .superRefine((a, ctx) => {
    if (a.outcome !== "aprobada") return;
    const { amount, vendor_id, account_masked } = a.payload;
    if (amount === null || vendor_id === null || account_masked === null) {
      ctx.addIssue({
        code: "custom",
        path: ["payload"],
        message: "aprobar exige monto, beneficiario registrado y cuenta",
      });
    }
    if (!checklistComplete(a.checklist)) {
      ctx.addIssue({
        code: "custom",
        path: ["checklist"],
        message: "aprobar exige el checklist completo",
      });
    }
  });
export type Approval = Readonly<z.infer<typeof ApprovalSchema>>;

/** Verdadero si hay al menos un punto y todos están marcados. */
export function checklistComplete(items: readonly ChecklistItem[]): boolean {
  return items.length > 0 && items.every((i) => i.checked);
}
