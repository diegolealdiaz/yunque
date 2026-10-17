import { and, count, desc, eq, gt, gte, like } from "drizzle-orm";

import { z } from "zod";

import { UlidSchema, type Ulid } from "@/src/domain";

import type { Executor } from "../client";
import { inboundAddresses, invoices } from "../schema";

/**
 * Direcciones de correo de entrada de la demo (D23) y los conteos de sus topes. Buscar por
 * token es, como buscar por visitante, la entrada a una empresa: el token sale de la
 * dirección a la que escribieron, nunca de algo que la empresa elija.
 */

const InboundAddressSchema = z.strictObject({
  token: z.string().regex(/^[a-z2-7]{12}$/),
  organizationId: UlidSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type InboundAddress = Readonly<z.infer<typeof InboundAddressSchema>>;

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
  return row ?? null;
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
  return row ?? null;
}

/** Prefijo de la llave de recepción de un correo real (`inbox:pm-<id del proveedor>`). */
export const INBOUND_RECEIPT_PREFIX = "inbox:pm-";

/**
 * Correos reales recibidos desde `since`: de una empresa, o de toda la demo con
 * `organizationId` null (el tope global; solo devuelve un número).
 */
export async function countInboundEmailsSince(
  exec: Executor,
  organizationId: Ulid | null,
  since: string,
): Promise<number> {
  const real = like(invoices.receiptKey, `${INBOUND_RECEIPT_PREFIX}%`);
  const recent = gte(invoices.receivedAt, since);
  const [row] = await exec
    .select({ n: count() })
    .from(invoices)
    .where(
      organizationId === null
        ? and(real, recent)
        : and(eq(invoices.organizationId, organizationId), real, recent),
    );
  return row?.n ?? 0;
}
