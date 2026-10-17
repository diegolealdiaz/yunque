import { getTableName, is, sql } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "@/src/db/client";
import {
  DbError,
  isAppendOnlyViolation,
  isCheckViolation,
  isForeignKeyViolation,
} from "@/src/db/errors";
import * as schema from "@/src/db/schema";
import * as repos from "@/src/db/repositories";

import { openTestDatabase, seedTestOrganization, type TestDatabase } from "./helpers";

const tableNames = Object.values(schema)
  .filter((v) => is(v, SQLiteTable))
  .map((t) => getTableName(t));

const MIGRATIONS = 5;

/** Única tabla sin organization_id (D14): la caché por contenido lleva `scope` en su lugar. */
const SCOPED_BY_CONTENT = "extraction_cache";

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
    await runMigrations(t.db);
    const rows = await t.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM __drizzle_migrations`);
    expect(rows[0]?.n).toBe(MIGRATIONS);
  });

  it("toda tabla tiene columna organization_id", async () => {
    for (const name of tableNames) {
      if (name === "organizations") continue;
      const columns = await t.db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${name})`));
      expect(
        columns.map((c) => c.name),
        name,
      ).toContain(name === SCOPED_BY_CONTENT ? "scope" : "organization_id");
    }
  });

  it("los repositorios exigen el id de organización en la firma", () => {
    // Excepciones: crean o buscan la organización misma, o reciben una entidad con organization_id.
    const exempt = new Set(["createOrganization", "findOrganizationByVisitor", "setBalance"]);
    // La caché por contenido (D14) exige su ámbito en la firma en lugar de la organización.
    const scoped = new Set(["getCachedExtraction", "putCachedExtraction"]);
    for (const [name, fn] of Object.entries(repos)) {
      if (typeof fn !== "function" || exempt.has(name)) continue;
      const source = fn.toString();
      if (scoped.has(name)) {
        expect(/^async function \w+\(\s*exec,\s*scope\b/.test(source), name).toBe(true);
        continue;
      }
      const takesOrgId = /^async function \w+\(\s*exec,\s*organizationId\b/.test(source);
      const takesEntity =
        /^async function \w+\(\s*exec,\s*\w+\s*\)/.test(source) &&
        /\w+Schema\.parse\(/.test(source);
      expect(takesOrgId || takesEntity, name).toBe(true);
    }
  });

  it("las claves foráneas están activas en cada conexión", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => t.db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)),
    );
    expect(results.map((r) => r[0]?.foreign_keys)).toEqual([1, 1, 1, 1, 1, 1]);
    await expect(
      t.db.insert(schema.vendors).values({
        id: t.newId(),
        organizationId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        name: "x",
        aliases: [],
        taxId: null,
        country: "CO",
        account: {
          country: "CO",
          currency: "COP",
          rail: "bre_b",
          account_number: "1234",
          holder_name: "x",
        },
        verification: { status: "pendiente" },
        agreement: { kind: "none" },
        createdAt: t.now().toISOString(),
      }),
    ).rejects.toSatisfy(isForeignKeyViolation);
  });
});

describe("tablas append-only (P-42)", () => {
  let t: TestDatabase;
  let orgId: string;
  let policyId: string;
  let policyHash: string;
  let invoiceId: string;
  let decisionId: string;
  let approvalId: string;
  const hash = "b".repeat(64);

  beforeEach(async () => {
    t = await openTestDatabase();
    const seeded = await seedTestOrganization(t);
    orgId = seeded.organization.id;
    policyId = seeded.policyVersionId;
    const policy = await repos.getPolicyVersion(t.db, orgId, policyId);
    policyHash = policy.content_hash;
    invoiceId = t.newId();
    decisionId = t.newId();
    const nowIso = t.now().toISOString();
    await t.db.insert(schema.invoices).values({
      id: invoiceId,
      organizationId: orgId,
      reference: "YQ-2026-10-0001",
      channel: "upload",
      receiptKey: "upload:prueba-1",
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
      policyVersionId: policyId,
      policyHash,
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
    approvalId = t.newId();
    await repos.insertApproval(t.db, approvalFor(approvalId));
  });
  afterEach(async () => {
    await t.close();
  });

  function approvalFor(id: string) {
    return {
      id,
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
        policy_version_id: policyId,
        policy_hash: policyHash,
      },
      signature: "c".repeat(64),
      consumed_at: null,
      created_at: t.now().toISOString(),
    };
  }

  it.each(schema.APPEND_ONLY_TABLES)("%s rechaza UPDATE y DELETE por trigger", async (table) => {
    await expect(t.db.run(sql.raw(`UPDATE ${table} SET organization_id = 'x'`))).rejects.toSatisfy(
      isAppendOnlyViolation,
    );
    await expect(t.db.run(sql.raw(`DELETE FROM ${table}`))).rejects.toSatisfy(
      isAppendOnlyViolation,
    );
  });

  it("INSERT OR REPLACE sobre un id existente también se rechaza", async () => {
    const [before] = await t.db.all<{ signed_by: string }>(
      sql`SELECT signed_by FROM policy_versions WHERE id = ${policyId}`,
    );
    await expect(
      t.db.run(
        sql`INSERT OR REPLACE INTO policy_versions (id, organization_id, version, content, content_hash, signed_by, signed_at, note)
            VALUES (${policyId}, ${orgId}, 99, '{"hack":true}', ${policyHash}, 'atacante', '2026-01-01T00:00:00.000Z', NULL)`,
      ),
    ).rejects.toSatisfy(isAppendOnlyViolation);
    await expect(
      t.db.run(
        sql`INSERT OR REPLACE INTO decisions SELECT * FROM decisions WHERE id = ${decisionId}`,
      ),
    ).rejects.toSatisfy(isAppendOnlyViolation);
    const [after] = await t.db.all<{ signed_by: string }>(
      sql`SELECT signed_by FROM policy_versions WHERE id = ${policyId}`,
    );
    expect(after?.signed_by).toBe(before?.signed_by);
  });

  it("el trigger de approvals cubre todas las columnas salvo consumed_at", async () => {
    const columns = await t.db.all<{ name: string }>(sql`PRAGMA table_info(approvals)`);
    const [trigger] = await t.db.all<{ sql: string }>(
      sql`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'approvals_no_update'`,
    );
    const listed = (/UPDATE OF\s+([\s\S]*?)\s+ON approvals/i.exec(trigger?.sql ?? "")?.[1] ?? "")
      .split(",")
      .map((c) => c.trim());
    const expected = columns.map((c) => c.name).filter((c) => c !== "consumed_at");
    expect(listed.sort()).toEqual(expected.sort());
  });

  it("approvals: una por decisión, consumida una sola vez, sin volver a NULL", async () => {
    await expect(repos.insertApproval(t.db, approvalFor(t.newId()))).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(t.db.run(sql`UPDATE approvals SET approver = 'otro'`)).rejects.toSatisfy(
      isAppendOnlyViolation,
    );
    const consumers = await Promise.all(
      Array.from({ length: 4 }, () =>
        repos.consumeApproval(t.db, orgId, approvalId, t.now().toISOString()).then(
          () => "ok",
          (e: unknown) => (e instanceof DbError ? e.code : "otro"),
        ),
      ),
    );
    expect(consumers.filter((r) => r === "ok")).toHaveLength(1);
    expect(consumers.filter((r) => r === "stale_state")).toHaveLength(3);
    await expect(t.db.run(sql`UPDATE approvals SET consumed_at = NULL`)).rejects.toSatisfy(
      isAppendOnlyViolation,
    );
  });

  it("los triggers de invariantes numéricas rechazan saldos negativos y compromisos sobre el límite", async () => {
    await expect(
      t.db.run(sql`UPDATE balances SET available = -1 WHERE organization_id = ${orgId}`),
    ).rejects.toSatisfy(isCheckViolation);
    await t.db.run(
      sql`INSERT INTO ledger_periods (organization_id, period_key, currency, "limit", committed, updated_at) VALUES (${orgId}, '2026-10', 'USD', 100, 0, 'x')`,
    );
    await expect(
      t.db.run(sql`UPDATE ledger_periods SET committed = 101 WHERE organization_id = ${orgId}`),
    ).rejects.toSatisfy(isCheckViolation);
    await expect(
      t.db.run(
        sql`INSERT INTO ledger_periods (organization_id, period_key, currency, "limit", committed, updated_at) VALUES (${orgId}, '2026-11', 'USD', 100, 101, 'x')`,
      ),
    ).rejects.toSatisfy(isCheckViolation);
  });
});
