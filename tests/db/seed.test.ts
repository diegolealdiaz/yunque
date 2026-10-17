import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase, getDatabase, withWriteTransaction } from "@/src/db/client";
import { DbError } from "@/src/db/errors";
import {
  appendPolicyVersion,
  debitBalance,
  ensureLedgerPeriod,
  findOrganizationByVisitor,
  getCurrentPolicy,
  getInvoice,
  getLedgerPeriod,
  insertInvoice,
  listBalances,
  listDecisionsByVendor,
  listEvents,
  listVendors,
  nextReference,
  releaseBudget,
  reserveBudget,
  transitionInvoice,
} from "@/src/db/repositories";
import type { Invoice } from "@/src/domain";

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
    expect(result.vendors).toHaveLength(8);
    expect(await listBalances(t.db, orgId)).toHaveLength(6);
    expect(await listVendors(t.db, orgId)).toHaveLength(8);
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

describe("cliente", () => {
  it("un fallo al abrir no queda cacheado y la siguiente llamada vuelve a intentar", async () => {
    await expect(getDatabase({ url: "file:/ruta/que/no/existe/x.db" })).rejects.toThrow();
    const t = await openTestDatabase();
    try {
      const db = await getDatabase({ url: `file:${t.path}` });
      expect(db).toBeDefined();
      closeDatabase(db);
    } finally {
      await t.close();
    }
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
    const seeded = (await listBalances(t.db, orgId)).find((b) => b.currency === "EUR");
    if (!seeded) throw new Error("la semilla no trae saldo EUR");
    await debitBalance(t.db, orgId, "EUR", seeded.available, now);
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

  it("un periodo inexistente es not_found, no budget_exceeded; cambiar la política actualiza el límite", async () => {
    const now = t.now().toISOString();
    await expect(reserveBudget(t.db, orgId, "2026-12", "USD", 1, now)).rejects.toMatchObject({
      code: "not_found",
    });
    await ensureLedgerPeriod(t.db, orgId, "2026-12", "USD", 1000, now);
    await reserveBudget(t.db, orgId, "2026-12", "USD", 900, now);
    await ensureLedgerPeriod(t.db, orgId, "2026-12", "USD", 500, now);
    const period = await getLedgerPeriod(t.db, orgId, "2026-12", "USD");
    expect(period).toMatchObject({ limit: 500, committed: 900 });
    await expect(reserveBudget(t.db, orgId, "2026-12", "USD", 1, now)).rejects.toMatchObject({
      code: "budget_exceeded",
    });
    await ensureLedgerPeriod(t.db, orgId, "2026-12", "USD", 2000, now);
    await reserveBudget(t.db, orgId, "2026-12", "USD", 1000, now);
    expect((await getLedgerPeriod(t.db, orgId, "2026-12", "USD"))?.committed).toBe(1900);
  });

  it("transacciones de escritura concurrentes (reserva + débito) terminan todas y en orden", async () => {
    const now = t.now().toISOString();
    await ensureLedgerPeriod(t.db, orgId, "2026-10", "USD", 100_000, now);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        withWriteTransaction(t.db, async (tx) => {
          await reserveBudget(tx, orgId, "2026-10", "USD", 1000, now);
          await debitBalance(tx, orgId, "USD", 1000, now);
          return "ok";
        }).catch((e: unknown) => (e instanceof DbError ? e.code : "otro")),
      ),
    );
    expect(results).toEqual(Array.from({ length: 8 }, () => "ok"));
    expect((await getLedgerPeriod(t.db, orgId, "2026-10", "USD"))?.committed).toBe(8000);
    const usd = (await listBalances(t.db, orgId)).find((b) => b.currency === "USD");
    expect(usd?.available).toBe(12_000_000 - 8000);
  });

  it("si la transacción falla después de reservar, la reserva se deshace", async () => {
    const now = t.now().toISOString();
    await ensureLedgerPeriod(t.db, orgId, "2026-10", "USD", 100_000, now);
    await expect(
      withWriteTransaction(t.db, async (tx) => {
        await reserveBudget(tx, orgId, "2026-10", "USD", 5000, now);
        await debitBalance(tx, orgId, "EUR", 999_999_999, now);
      }),
    ).rejects.toMatchObject({ code: "insufficient_balance" });
    expect((await getLedgerPeriod(t.db, orgId, "2026-10", "USD"))?.committed).toBe(0);
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

  it("dos versiones de política guardadas a la vez: exactamente una gana (conflict en la otra)", async () => {
    const current = await getCurrentPolicy(t.db, orgId);
    expect(current).not.toBeNull();
    if (!current) return;
    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        withWriteTransaction(t.db, (tx) =>
          appendPolicyVersion(
            tx,
            orgId,
            {
              content: current.content,
              signedBy: `p${String(i)}`,
              signedAt: t.now().toISOString(),
            },
            t.newId,
          ),
        ).then(
          (v) => `v${String(v.version)}`,
          (e: unknown) => (e instanceof DbError ? e.code : "otro"),
        ),
      ),
    );
    // Serializadas en proceso: cada una ve la anterior y toma el siguiente número.
    expect(results.sort()).toEqual(["v2", "v3", "v4"]);
    const race = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        appendPolicyVersion(
          t.db,
          orgId,
          { content: current.content, signedBy: `q${String(i)}`, signedAt: t.now().toISOString() },
          t.newId,
        ).then(
          () => "ok",
          (e: unknown) => (e instanceof DbError ? e.code : "otro"),
        ),
      ),
    );
    // Sin transacción serializada compiten por la restricción única: una gana, dos reciben conflict.
    expect(race.filter((r) => r === "ok")).toHaveLength(1);
    expect(race.filter((r) => r === "conflict")).toHaveLength(2);
    expect((await getCurrentPolicy(t.db, orgId))?.version).toBe(5);
  });
});

describe("facturas y decisiones", () => {
  let t: TestDatabase;
  let orgId: string;
  let vendorId: string;
  beforeEach(async () => {
    t = await openTestDatabase();
    const seeded = await seedTestOrganization(t);
    orgId = seeded.organization.id;
    vendorId = seeded.vendors[0]?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  function invoice(hash: string): Invoice {
    const nowIso = t.now().toISOString();
    return {
      id: t.newId(),
      organization_id: orgId,
      reference: `YQ-2026-10-${hash.slice(0, 4)}`,
      channel: "upload",
      receipt_key: `upload:${hash.slice(0, 8)}`,
      source_kind: "pdf",
      document_hash: hash,
      file_key: `files/${hash}`,
      file_state: "subida",
      original_name: "f.pdf",
      mime_type: "application/pdf",
      size_bytes: 10,
      page_keys: [],
      text: null,
      semantic_key: null,
      status: "recibida",
      approval_expires_at: null,
      channel_meta: {},
      received_at: nowIso,
      updated_at: nowIso,
    };
  }

  it("transiciones por comparación y cambio (P-47): solo las permitidas y solo desde el estado actual", async () => {
    const inv = invoice("1111".repeat(16));
    await insertInvoice(t.db, inv);
    // La misma entrega dos veces es una sola factura (P-46).
    await expect(
      insertInvoice(t.db, { ...inv, id: t.newId(), reference: "YQ-2026-10-9999" }),
    ).rejects.toMatchObject({ code: "conflict" });
    // El mismo archivo por otra entrega sí es otra factura: el motor la frena como duplicada.
    await insertInvoice(t.db, {
      ...inv,
      id: t.newId(),
      reference: "YQ-2026-10-9998",
      receipt_key: "upload:otra-entrega",
    });
    await expect(
      transitionInvoice(t.db, orgId, inv.id, "recibida", "aprobada", t.now().toISOString()),
    ).rejects.toMatchObject({ code: "stale_state" });

    const racers = await Promise.all(
      Array.from({ length: 3 }, () =>
        transitionInvoice(
          t.db,
          orgId,
          inv.id,
          "recibida",
          "procesando",
          t.now().toISOString(),
        ).then(
          () => "ok",
          (e: unknown) => (e instanceof DbError ? e.code : "otro"),
        ),
      ),
    );
    expect(racers.filter((r) => r === "ok")).toHaveLength(1);
    expect(racers.filter((r) => r === "stale_state")).toHaveLength(2);
    expect((await getInvoice(t.db, orgId, inv.id)).status).toBe("procesando");

    await transitionInvoice(t.db, orgId, inv.id, "procesando", "decidida", t.now().toISOString(), {
      semantic_key: "X|1|1|USD",
      text: "hola",
    });
    const updated = await getInvoice(t.db, orgId, inv.id);
    expect(updated).toMatchObject({ status: "decidida", semantic_key: "X|1|1|USD", text: "hola" });
  });

  it("las decisiones por vendor se consultan desde una fecha, más recientes primero", async () => {
    const policy = await getCurrentPolicy(t.db, orgId);
    if (!policy) throw new Error("sin política");
    const { insertDecision } = await import("@/src/db/repositories");
    const inv = invoice("2222".repeat(16));
    await insertInvoice(t.db, inv);
    const dates = ["2026-08-01", "2026-09-01", "2026-10-01"];
    for (const d of dates) {
      await insertDecision(t.db, {
        id: t.newId(),
        organization_id: orgId,
        invoice_id: inv.id,
        verdict: "frenar",
        findings: [],
        explanation: "x",
        summary: null,
        scheduled_for: null,
        payment_order: null,
        amount: { amount: 100, currency: "USD" },
        amount_usd: { amount: 100, currency: "USD" },
        vendor_id: vendorId,
        policy_version_id: policy.id,
        policy_hash: policy.content_hash,
        document_hash: inv.document_hash,
        extraction_hash: null,
        field_sources: {},
        previous_decision_id: null,
        dry_run: false,
        actor: { kind: "agente" },
        cost_usd_micros: 0,
        latency_ms: 0,
        decided_at: `${d}T00:00:00.000Z`,
      });
    }
    const since = await listDecisionsByVendor(t.db, orgId, vendorId, "2026-09-01T00:00:00.000Z");
    expect(since.map((d) => d.decided_at.slice(0, 10))).toEqual(["2026-10-01", "2026-09-01"]);
  });
});
