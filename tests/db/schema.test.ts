import { getTableName, is, sql } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DbError, isAppendOnlyViolation } from "@/src/db/errors";
import * as schema from "@/src/db/schema";
import { consumeApproval, insertApproval } from "@/src/db/repositories";

import { openTestDatabase, seedTestOrganization, type TestDatabase } from "./helpers";

const tableNames = Object.values(schema)
  .filter((v) => is(v, SQLiteTable))
  .map((t) => getTableName(t));

describe("migraciones y esquema (P-40, P-41)", () => {
  let t: TestDatabase;
  beforeEach(async () => {
    t = await openTestDatabase();
  });
  afterEach(async () => {
    await t.close();
  });

  it("las migraciones corren de cero y crean todas las tablas del esquema drizzle", async () => {
    const rows = await t.db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
    );
    const actual = rows.map((r) => r.name).sort();
    expect(actual).toEqual([...tableNames].sort());
    expect(actual.length).toBeGreaterThanOrEqual(12);
  });

  it("correr las migraciones dos veces no falla ni duplica", async () => {
    const { runMigrations } = await import("@/src/db/client");
    await runMigrations(t.db);
    const rows = await t.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM __drizzle_migrations`);
    expect(rows[0]?.n).toBe(2);
  });

  it("toda tabla tiene columna organization_id", async () => {
    for (const name of tableNames) {
      if (name === "organizations") continue;
      const columns = await t.db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${name})`));
      expect(
        columns.map((c) => c.name),
        name,
      ).toContain("organization_id");
    }
  });

  it("los repositorios exigen el id de organización en la firma", async () => {
    const repos = await import("@/src/db/repositories");
    // Excepciones: crean o buscan la organización misma, o reciben una entidad con organization_id.
    const exempt = new Set(["createOrganization", "findOrganizationByVisitor", "setBalance"]);
    for (const [name, fn] of Object.entries(repos)) {
      if (typeof fn !== "function" || exempt.has(name)) continue;
      const source = fn.toString();
      const takesOrgId = /^async function \w+\(\s*exec,\s*organizationId\b/.test(source);
      const takesEntity =
        /^async function \w+\(\s*exec,\s*\w+\s*\)/.test(source) &&
        /\w+Schema\.parse\(/.test(source);
      expect(takesOrgId || takesEntity, name).toBe(true);
    }
  });
});

describe("tablas append-only (P-42)", () => {
  let t: TestDatabase;
  beforeEach(async () => {
    t = await openTestDatabase();
    await seedTestOrganization(t);
  });
  afterEach(async () => {
    await t.close();
  });

  it("policy_versions y audit_events rechazan UPDATE y DELETE por trigger", async () => {
    for (const table of ["policy_versions", "audit_events"]) {
      await expect(
        t.db.run(sql.raw(`UPDATE ${table} SET organization_id = 'x'`)),
      ).rejects.toSatisfy(isAppendOnlyViolation);
      await expect(t.db.run(sql.raw(`DELETE FROM ${table}`))).rejects.toSatisfy(
        isAppendOnlyViolation,
      );
    }
    const [row] = await t.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM policy_versions`);
    expect(row?.n).toBe(1);
  });

  it("decisions y approvals rechazan UPDATE y DELETE; approvals solo consume una vez", async () => {
    const orgId = (await t.db.query.organizations.findFirst())?.id;
    const policy = await t.db.query.policyVersions.findFirst();
    expect(orgId && policy).toBeTruthy();
    if (!orgId || !policy) return;
    const hash = "b".repeat(64);
    const invoiceId = t.newId();
    const decisionId = t.newId();
    const nowIso = t.now().toISOString();
    await t.db.insert(schema.invoices).values({
      id: invoiceId,
      organizationId: orgId,
      reference: "YQ-2026-10-0001",
      channel: "upload",
      sourceKind: "pdf",
      documentHash: hash,
      fileKey: "k",
      fileState: "subida",
      originalName: "f.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      pageKeys: [],
      text: null,
      semanticKey: null,
      status: "esperando_aprobacion",
      approvalExpiresAt: null,
      channelMeta: {},
      receivedAt: nowIso,
      updatedAt: nowIso,
    });
    await t.db.insert(schema.decisions).values({
      id: decisionId,
      organizationId: orgId,
      invoiceId,
      verdict: "escalar",
      findings: [],
      explanation: "x",
      summary: null,
      scheduledFor: null,
      paymentOrder: null,
      amount: null,
      amountCurrency: null,
      amountUsd: null,
      vendorId: null,
      policyVersionId: policy.id,
      policyHash: policy.contentHash,
      documentHash: hash,
      extractionHash: null,
      fieldSources: {},
      previousDecisionId: null,
      dryRun: false,
      actor: { kind: "agente" },
      costUsdMicros: 0,
      latencyMs: 0,
      decidedAt: nowIso,
    });
    await expect(t.db.run(sql`UPDATE decisions SET verdict = 'pagar'`)).rejects.toSatisfy(
      isAppendOnlyViolation,
    );
    await expect(t.db.run(sql`DELETE FROM decisions`)).rejects.toSatisfy(isAppendOnlyViolation);

    const approvalId = t.newId();
    const approval = {
      id: approvalId,
      organization_id: orgId,
      invoice_id: invoiceId,
      decision_id: decisionId,
      outcome: "aprobada" as const,
      approver: "Diego Leal",
      checklist: [{ code: "general" as const, text: "Revisado", checked: true }],
      reason: null,
      payload: {
        invoice_id: invoiceId,
        decision_id: decisionId,
        document_hash: hash,
        amount: { amount: 100, currency: "USD" as const },
        vendor_id: invoiceId,
        account_masked: "****1234",
        policy_version_id: policy.id,
        policy_hash: policy.contentHash,
      },
      signature: "c".repeat(64),
      consumed_at: null,
      created_at: nowIso,
    };
    await insertApproval(t.db, approval);
    await expect(insertApproval(t.db, { ...approval, id: t.newId() })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(t.db.run(sql`UPDATE approvals SET approver = 'otro'`)).rejects.toSatisfy(
      isAppendOnlyViolation,
    );
    await consumeApproval(t.db, orgId, approvalId, t.now().toISOString());
    await expect(
      consumeApproval(t.db, orgId, approvalId, t.now().toISOString()),
    ).rejects.toBeInstanceOf(DbError);
    await expect(t.db.run(sql`UPDATE approvals SET consumed_at = NULL`)).rejects.toSatisfy(
      isAppendOnlyViolation,
    );
    await expect(t.db.run(sql`DELETE FROM approvals`)).rejects.toSatisfy(isAppendOnlyViolation);
  });
});
