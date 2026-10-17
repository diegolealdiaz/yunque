import { and, count, desc, eq, gt, gte } from "drizzle-orm";
import { z } from "zod";

import {
  InboundMessageIdSchema,
  InboundRejectReasonSchema,
  InboundTokenSchema,
  UlidSchema,
  type InboundRejectReason,
  type Ulid,
} from "@/src/domain";

import type { Executor } from "../client";
import { parseRow } from "../rows";
import { inboundAddresses, inboundReceipts } from "../schema";

/**
 * Correo de entrada de la demo (D23): las direcciones de cada visitante y los recibos de
 * cada correo que llega a una de ellas, con los conteos de los topes del día.
 *
 * Buscar una dirección por su token o un recibo por el id del proveedor es, como buscar por
 * visitante, la entrada a una empresa: el token sale de la dirección a la que escribieron,
 * nunca de algo que la empresa elija.
 */

const InboundAddressSchema = z.strictObject({
  token: InboundTokenSchema,
  organizationId: UlidSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type InboundAddress = Readonly<z.infer<typeof InboundAddressSchema>>;

const InboundReceiptSchema = z.discriminatedUnion("status", [
  z.strictObject({
    messageId: InboundMessageIdSchema,
    organizationId: UlidSchema,
    token: InboundTokenSchema,
    status: z.literal("admitido"),
    reason: z.null(),
    receivedAt: z.iso.datetime(),
  }),
  z.strictObject({
    messageId: InboundMessageIdSchema,
    organizationId: UlidSchema,
    token: InboundTokenSchema,
    status: z.literal("rechazado"),
    reason: InboundRejectReasonSchema,
    receivedAt: z.iso.datetime(),
  }),
]);
export type InboundReceipt = Readonly<z.infer<typeof InboundReceiptSchema>>;

export async function insertInboundAddress(exec: Executor, address: InboundAddress): Promise<void> {
  await exec.insert(inboundAddresses).values(InboundAddressSchema.parse(address));
}

/** La dirección de un token, vencida o no; null si no existe. */
export async function findInboundAddress(
  exec: Executor,
  token: string,
): Promise<InboundAddress | null> {
  const [row] = await exec
    .select()
    .from(inboundAddresses)
    .where(eq(inboundAddresses.token, token))
    .limit(1);
  return row ? parseRow(InboundAddressSchema, row, "inbound_addresses") : null;
}

/** La dirección vigente de la empresa a `now`: la que vence más tarde, si alguna sigue viva. */
export async function findActiveInboundAddress(
  exec: Executor,
  organizationId: Ulid,
  now: string,
): Promise<InboundAddress | null> {
  const [row] = await exec
    .select()
    .from(inboundAddresses)
    .where(
      and(eq(inboundAddresses.organizationId, organizationId), gt(inboundAddresses.expiresAt, now)),
    )
    .orderBy(desc(inboundAddresses.expiresAt))
    .limit(1);
  return row ? parseRow(InboundAddressSchema, row, "inbound_addresses") : null;
}

export async function insertInboundReceipt(exec: Executor, receipt: InboundReceipt): Promise<void> {
  await exec.insert(inboundReceipts).values(InboundReceiptSchema.parse(receipt));
}

/** El recibo de un correo por el id del proveedor; null si nunca llegó. */
export async function findInboundReceipt(
  exec: Executor,
  messageId: string,
): Promise<InboundReceipt | null> {
  const [row] = await exec
    .select()
    .from(inboundReceipts)
    .where(eq(inboundReceipts.messageId, messageId))
    .limit(1);
  return row ? parseRow(InboundReceiptSchema, row, "inbound_receipts") : null;
}

/** Correos admitidos por una dirección de la empresa desde `since`: base del tope por dirección. */
export async function countAdmittedByAddressSince(
  exec: Executor,
  organizationId: Ulid,
  token: string,
  since: string,
): Promise<number> {
  const [row] = await exec
    .select({ n: count() })
    .from(inboundReceipts)
    .where(
      and(
        eq(inboundReceipts.organizationId, organizationId),
        eq(inboundReceipts.token, token),
        eq(inboundReceipts.status, "admitido"),
        gte(inboundReceipts.receivedAt, since),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Correos admitidos en toda la demo desde `since`: base del tope global. Como
 * `countAllInvoicesSince`, cuenta sobre todas las empresas y solo devuelve un número.
 */
export async function countAllAdmittedSince(exec: Executor, since: string): Promise<number> {
  const [row] = await exec
    .select({ n: count() })
    .from(inboundReceipts)
    .where(and(eq(inboundReceipts.status, "admitido"), gte(inboundReceipts.receivedAt, since)));
  return row?.n ?? 0;
}

/** Correos rechazados de la empresa desde `since`, en total o por un motivo. */
export async function countRejectedSince(
  exec: Executor,
  organizationId: Ulid,
  since: string,
  reason?: InboundRejectReason,
): Promise<number> {
  const [row] = await exec
    .select({ n: count() })
    .from(inboundReceipts)
    .where(
      and(
        eq(inboundReceipts.organizationId, organizationId),
        eq(inboundReceipts.status, "rechazado"),
        gte(inboundReceipts.receivedAt, since),
        reason === undefined ? undefined : eq(inboundReceipts.reason, reason),
      ),
    );
  return row?.n ?? 0;
}
