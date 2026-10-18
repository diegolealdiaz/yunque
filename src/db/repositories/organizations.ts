import { and, asc, count, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";

import {
  BalanceSchema,
  OrganizationSchema,
  makeReference,
  type Balance,
  type Currency,
  type Organization,
  type Reference,
  type Ulid,
} from "@/src/domain";

import type { Executor } from "../client";
import { DbError } from "../errors";
import { parseRow } from "../rows";
import { balances, organizations, referenceCounters } from "../schema";

/**
 * Organizaciones, saldos y consecutivos de referencia.
 * Toda función recibe el ejecutor (base o transacción) y, salvo al crear, el id de organización.
 */

/** Crea una organización nueva. */
export async function createOrganization(exec: Executor, org: Organization): Promise<void> {
  const row = OrganizationSchema.parse(org);
  await exec.insert(organizations).values({
    id: row.id,
    name: row.name,
    referencePrefix: row.reference_prefix,
    baseCurrency: row.base_currency,
    fx: row.fx,
    demoVisitorId: row.demo_visitor_id,
    createdAt: row.created_at,
  });
}

function toOrganization(row: typeof organizations.$inferSelect): Organization {
  return parseRow(
    OrganizationSchema,
    {
      id: row.id,
      name: row.name,
      reference_prefix: row.referencePrefix,
      base_currency: row.baseCurrency,
      fx: row.fx,
      demo_visitor_id: row.demoVisitorId,
      created_at: row.createdAt,
    },
    "organizations",
  );
}

/** Organización por id; `not_found` si no existe. */
export async function getOrganization(exec: Executor, organizationId: Ulid): Promise<Organization> {
  const row = await exec.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  if (!row) throw new DbError("not_found", `Organización ${organizationId} no existe`);
  return toOrganization(row);
}

/** Copia de la demo de un visitante, o null si todavía no tiene. */
export async function findOrganizationByVisitor(
  exec: Executor,
  visitorId: string,
): Promise<Organization | null> {
  const row = await exec.query.organizations.findFirst({
    where: eq(organizations.demoVisitorId, visitorId),
  });
  return row ? toOrganization(row) : null;
}

/**
 * Empresas de ejemplo de la demo creadas desde `since` (ISO): base del tope de visitantes
 * nuevos por día. Sin filtro de organización, y solo devuelve un número.
 */
export async function countVisitorOrganizationsSince(
  exec: Executor,
  since: string,
): Promise<number> {
  const [row] = await exec
    .select({ n: count() })
    .from(organizations)
    .where(and(isNotNull(organizations.demoVisitorId), gte(organizations.createdAt, since)));
  return row?.n ?? 0;
}

/**
 * Empresa base, la que no pertenece a ningún visitante de la demo: la de la base local o la
 * del cliente en producto. La más antigua si hubiera varias. Null si todavía no se sembró.
 */
export async function findBaseOrganization(exec: Executor): Promise<Organization | null> {
  const row = await exec.query.organizations.findFirst({
    where: isNull(organizations.demoVisitorId),
    orderBy: [asc(organizations.createdAt), asc(organizations.id)],
  });
  return row ? toOrganization(row) : null;
}

/** Fija el saldo de una moneda (alta o reemplazo completo, no un ajuste). */
export async function setBalance(exec: Executor, balance: Balance): Promise<void> {
  const row = BalanceSchema.parse(balance);
  await exec
    .insert(balances)
    .values({
      organizationId: row.organization_id,
      currency: row.currency,
      available: row.available,
      updatedAt: row.updated_at,
    })
    .onConflictDoUpdate({
      target: [balances.organizationId, balances.currency],
      set: { available: row.available, updatedAt: row.updated_at },
    });
}

/** Saldos de la organización por moneda. */
export async function listBalances(exec: Executor, organizationId: Ulid): Promise<Balance[]> {
  const rows = await exec.query.balances.findMany({
    where: eq(balances.organizationId, organizationId),
  });
  return rows.map((r) =>
    parseRow(
      BalanceSchema,
      {
        organization_id: r.organizationId,
        currency: r.currency,
        available: r.available,
        updated_at: r.updatedAt,
      },
      "balances",
    ),
  );
}

/**
 * Descuenta saldo solo si alcanza: `UPDATE ... WHERE available >= amount`.
 * Si no afecta filas, lanza `insufficient_balance`. Nunca deja el saldo en negativo.
 */
export async function debitBalance(
  exec: Executor,
  organizationId: Ulid,
  currency: Currency,
  amount: number,
  now: string,
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError("El débito debe ser un entero positivo");
  }
  const result = await exec
    .update(balances)
    .set({ available: sql`${balances.available} - ${amount}`, updatedAt: now })
    .where(
      and(
        eq(balances.organizationId, organizationId),
        eq(balances.currency, currency),
        sql`${balances.available} >= ${amount}`,
      ),
    );
  if (result.rowsAffected === 0) {
    throw new DbError("insufficient_balance", `Saldo insuficiente en ${currency}`);
  }
}

/**
 * Siguiente referencia legible del mes, única por organización. Debe llamarse dentro de la
 * transacción que inserta la factura: el contador se incrementa en la misma escritura.
 */
export async function nextReference(
  exec: Executor,
  organizationId: Ulid,
  prefix: string,
  date: Date,
): Promise<Reference> {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const yearMonth = `${String(year)}-${String(month).padStart(2, "0")}`;
  const [row] = await exec
    .insert(referenceCounters)
    .values({ organizationId, yearMonth, nextSequence: 2 })
    .onConflictDoUpdate({
      target: [referenceCounters.organizationId, referenceCounters.yearMonth],
      set: { nextSequence: sql`${referenceCounters.nextSequence} + 1` },
    })
    .returning({ nextSequence: referenceCounters.nextSequence });
  if (!row) throw new DbError("conflict", "No se pudo asignar la referencia");
  return makeReference(prefix, year, month, row.nextSequence - 1);
}
