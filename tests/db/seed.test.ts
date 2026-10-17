import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DbError } from "@/src/db/errors";
import {
  debitBalance,
  ensureLedgerPeriod,
  findOrganizationByVisitor,
  getCurrentPolicy,
  getLedgerPeriod,
  listBalances,
  listEvents,
  listVendors,
  nextReference,
  releaseBudget,
  reserveBudget,
} from "@/src/db/repositories";

import { openTestDatabase, seedTestOrganization, type TestDatabase } from "./helpers";

describe("semilla", () => {
  let t: TestDatabase;
  beforeEach(async () => {
    t = await openTestDatabase();
  });
  afterEach(async () => {
    await t.close();
  });

  it("deja una empresa lista: saldos, vendors, política v1 y evento en bitácora", async () => {
    const result = await seedTestOrganization(t);
    const orgId = result.organization.id;
    expect(result.vendors).toHaveLength(7);
    expect(await listBalances(t.db, orgId)).toHaveLength(6);
    expect(await listVendors(t.db, orgId)).toHaveLength(7);
    const policy = await getCurrentPolicy(t.db, orgId);
    expect(policy?.version).toBe(1);
    expect(policy?.content.allowed_payees).toEqual(result.vendors.map((v) => v.id));
    expect(policy?.content.protected.system_hard_cap_usd_cents).toBe(10_000_000);
    const events = await listEvents(t.db, orgId);
    expect(events.map((e) => e.type)).toEqual(["policy.saved"]);
  });

  it("dos copias por visitante no comparten ids y se encuentran por visitante", async () => {
    const a = await seedTestOrganization(t, "visitante-a");
    const b = await seedTestOrganization(t, "visitante-b");
    expect(a.organization.id).not.toBe(b.organization.id);
    const idsA = new Set(a.vendors.map((v) => v.id));
    expect(b.vendors.some((v) => idsA.has(v.id))).toBe(false);
    expect((await findOrganizationByVisitor(t.db, "visitante-b"))?.id).toBe(b.organization.id);
    expect(await findOrganizationByVisitor(t.db, "nadie")).toBeNull();
    await expect(seedTestOrganization(t, "visitante-a")).rejects.toThrow();
  });
});

describe("saldos, presupuesto y referencias", () => {
  let t: TestDatabase;
  let orgId: string;
  beforeEach(async () => {
    t = await openTestDatabase();
    orgId = (await seedTestOrganization(t)).organization.id;
  });
  afterEach(async () => {
    await t.close();
  });

  it("el débito solo prospera si alcanza y nunca deja negativo", async () => {
    const now = t.now().toISOString();
    await debitBalance(t.db, orgId, "EUR", 800_000, now);
    await expect(debitBalance(t.db, orgId, "EUR", 1, now)).rejects.toMatchObject({
      code: "insufficient_balance",
    });
    const eur = (await listBalances(t.db, orgId)).find((b) => b.currency === "EUR");
    expect(eur?.available).toBe(0);
    await expect(debitBalance(t.db, orgId, "EUR", 0, now)).rejects.toThrow(RangeError);
  });

  it("la reserva de presupuesto respeta el límite bajo concurrencia (P-43)", async () => {
    const now = t.now().toISOString();
    await ensureLedgerPeriod(t.db, orgId, "2026-10", "USD", 1000, now);
    await ensureLedgerPeriod(t.db, orgId, "2026-10", "USD", 5, now);
    const attempts = Array.from({ length: 25 }, () =>
      reserveBudget(t.db, orgId, "2026-10", "USD", 100, now).then(
        () => "ok",
        (e: unknown) => (e instanceof DbError ? e.code : "otro"),
      ),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === "ok")).toHaveLength(10);
    expect(results.filter((r) => r === "budget_exceeded")).toHaveLength(15);
    expect((await getLedgerPeriod(t.db, orgId, "2026-10", "USD"))?.committed).toBe(1000);
    await releaseBudget(t.db, orgId, "2026-10", "USD", 300, now);
    expect((await getLedgerPeriod(t.db, orgId, "2026-10", "USD"))?.committed).toBe(700);
    await expect(releaseBudget(t.db, orgId, "2026-10", "USD", 701, now)).rejects.toMatchObject({
      code: "stale_state",
    });
  });

  it("las referencias son consecutivas por mes y únicas bajo concurrencia", async () => {
    const date = new Date("2026-10-17T00:00:00Z");
    const refs = await Promise.all(
      Array.from({ length: 20 }, () => nextReference(t.db, orgId, "YQ", date)),
    );
    expect(new Set(refs).size).toBe(20);
    expect(refs.sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `YQ-2026-10-${String(i + 1).padStart(4, "0")}`),
    );
    expect(await nextReference(t.db, orgId, "YQ", new Date("2026-11-01T00:00:00Z"))).toBe(
      "YQ-2026-11-0001",
    );
  });
});
