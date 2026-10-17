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

/** Lo que la persona firma. Se serializa canónicamente y se firma con HMAC. */
export const ApprovalPayloadSchema = z.strictObject({
  invoice_id: UlidSchema,
  decision_id: UlidSchema,
  document_hash: Sha256Schema,
  amount: MoneySchema,
  vendor_id: UlidSchema,
  account_masked: z.string().regex(/^\*{4}[A-Za-z0-9]{1,4}$/),
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

export const ApprovalSchema = z.strictObject({
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
});
export type Approval = Readonly<z.infer<typeof ApprovalSchema>>;

/** Verdadero si hay al menos un punto y todos están marcados. */
export function checklistComplete(items: readonly ChecklistItem[]): boolean {
  return items.length > 0 && items.every((i) => i.checked);
}
