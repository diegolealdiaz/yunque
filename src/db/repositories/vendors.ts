import { and, eq } from "drizzle-orm";

import { VendorSchema, type Ulid, type Vendor } from "@/src/domain";

import type { Executor } from "../client";
import { DbError } from "../errors";
import { parseRow } from "../rows";
import { vendors } from "../schema";

/**
 * Vendors: los beneficiarios permitidos de cada empresa. Son la única fuente de los datos de
 * pago de una orden: la cuenta sale de aquí, nunca del texto de la factura.
 */

/** Da de alta un vendor. */
export async function insertVendor(exec: Executor, vendor: Vendor): Promise<void> {
  const v = VendorSchema.parse(vendor);
  await exec.insert(vendors).values({
    id: v.id,
    organizationId: v.organization_id,
    name: v.name,
    aliases: [...v.aliases],
    taxId: v.tax_id ?? null,
    country: v.country,
    account: v.account,
    verification: v.verification,
    agreement: v.agreement,
    createdAt: v.created_at,
  });
}

function toVendor(row: typeof vendors.$inferSelect): Vendor {
  return parseRow(
    VendorSchema,
    {
      id: row.id,
      organization_id: row.organizationId,
      name: row.name,
      aliases: row.aliases,
      ...(row.taxId === null ? {} : { tax_id: row.taxId }),
      country: row.country,
      account: row.account,
      verification: row.verification,
      agreement: row.agreement,
      created_at: row.createdAt,
    },
    "vendors",
  );
}

/** Vendors de la organización, por nombre. */
export async function listVendors(exec: Executor, organizationId: Ulid): Promise<Vendor[]> {
  const rows = await exec.query.vendors.findMany({
    where: eq(vendors.organizationId, organizationId),
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  return rows.map(toVendor);
}

/** Vendor por id; `not_found` si no existe. */
export async function getVendor(
  exec: Executor,
  organizationId: Ulid,
  vendorId: Ulid,
): Promise<Vendor> {
  const row = await exec.query.vendors.findFirst({
    where: and(eq(vendors.organizationId, organizationId), eq(vendors.id, vendorId)),
  });
  if (!row) throw new DbError("not_found", `Vendor ${vendorId} no existe`);
  return toVendor(row);
}
