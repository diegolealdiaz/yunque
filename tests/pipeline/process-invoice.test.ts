import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import {
  PolicySchema,
  isSupportedCurrency,
  periodKey,
  toUsd,
  type AuditEvent,
  type Decision,
  type InvoiceStatus,
  type Policy,
} from "@/src/domain";
import { decidingFinding } from "@/src/engine";
import { UseCaseError, processInvoice, type ProcessInvoiceResult } from "@/src/usecases";

import { datasetCase, datasetCases, openPipeline, type Pipeline } from "./helpers";

/** Decisión de un resultado procesado; falla la prueba si falta o si la entrega ya existía. */
function decided(result: ProcessInvoiceResult | undefined): Decision {
  if (!result) throw new Error("caso sin resultado");
  if (result.kind !== "decided") throw new Error(`se esperaba una decisión, llegó ${result.kind}`);
  return result.decision;
}

/** Estado que se deduce de la bitácora: cada evento de transición fija un estado. */
const STATUS_BY_EVENT: Partial<Record<AuditEvent["type"], InvoiceStatus>> = {
  "invoice.received": "recibida",
  "invoice.processing": "procesando",
  "invoice.decided": "decidida",
  "invoice.escalated": "esperando_aprobacion",
  "invoice.failed": "fallida",
};

function statusFromEvents(events: readonly AuditEvent[]): InvoiceStatus | null {
  let status: InvoiceStatus | null = null;
  for (const e of [...events].reverse()) status = STATUS_BY_EVENT[e.type] ?? status;
  return status;
}

/** Guarda una versión nueva de la política con otros controles. */
async function setControls(p: Pipeline, controls: Partial<Policy["controls"]>): Promise<void> {
  const current = p.policyVersion.content;
  const content = PolicySchema.parse({
    ...current,
    controls: { ...current.controls, ...controls },
  });
  await repos.appendPolicyVersion(
    p.t.db,
    p.organizationId,
    { content, signedBy: "Ana Torres", signedAt: p.t.now().toISOString() },
    p.t.newId,
  );
}

describe("processInvoice sobre el dataset completo (P-80, P-86)", () => {
  let p: Pipeline;
  const results = new Map<string, ProcessInvoiceResult>();
  let committedBefore = 0;

  beforeAll(async () => {
    p = await openPipeline();
    const period = periodKey(new Date("2026-10-17T00:00:00.000Z"), "month");
    committedBefore =
      (await repos.getLedgerPeriod(p.t.db, p.organizationId, period, "USD"))?.committed ?? -1;
    for (const fixture of await datasetCases()) {
      p.client.next = fixture.modelOutput;
      const result = await processInvoice(p.deps, {
        ...p.input(fixture.bytes, `batch:${fixture.case.id}`, fixture.fileName),
        channel: "batch",
      });
      results.set(fixture.case.id, result);
    }
  }, 180_000);

  afterAll(async () => {
    await p.close();
  });

  it("P-80 cada factura termina en el veredicto y la regla esperados, con versión y hash de política", async () => {
    const mismatches: string[] = [];
    for (const fixture of await datasetCases()) {
      const decision = decided(results.get(fixture.case.id));
      const rule = decidingFinding(decision)?.code ?? null;
      const { verdict, rule: expectedRule } = fixture.case.expected;
      if (decision.verdict !== verdict || rule !== expectedRule) {
        mismatches.push(
          `${fixture.case.id}: ${decision.verdict}/${String(rule)} ≠ ${verdict}/${String(expectedRule)}`,
        );
      }
      expect(decision.policy_version_id).toBe(p.policyVersion.id);
      expect(decision.policy_hash).toBe(p.policyVersion.content_hash);
      expect(decision.document_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(mismatches).toEqual([]);
  });

  it("cero falsos pagar y la orden de pago sale siempre del vendor registrado", async () => {
    for (const fixture of await datasetCases()) {
      const decision = decided(results.get(fixture.case.id));
      if (fixture.case.expected.verdict !== "pagar") expect(decision.verdict).not.toBe("pagar");
      if (decision.verdict !== "pagar") {
        expect(decision.payment_order).toBeNull();
        continue;
      }
      const order = decision.payment_order;
      expect(order?.status).toBe("preparada_no_ejecutada");
      const vendor = await repos.getVendor(p.t.db, p.organizationId, order?.vendor_id ?? "");
      expect(order?.beneficiary_name).toBe(vendor.name);
      expect(order?.account_masked).toBe(`****${vendor.account.account_number.slice(-4)}`);
      expect(order?.scheduled_for).toBe(decision.scheduled_for);
    }
  });

  it("el presupuesto comprometido y los saldos se mueven exactamente por lo pagado", async () => {
    const paid = [...results.values()].map(decided).filter((d) => d.verdict === "pagar");
    const org = await repos.getOrganization(p.t.db, p.organizationId);
    const usd = paid.reduce((acc, d) => acc + (d.amount ? toUsd(d.amount, org.fx).amount : 0), 0);
    const period = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    expect(period?.committed).toBe(committedBefore + usd);
    expect((period?.committed ?? 0) <= (period?.limit ?? 0)).toBe(true);
  });

  it("P-86 la bitácora reconstruye el estado final de cada factura y cada decisión tiene su aviso", async () => {
    for (const result of results.values()) {
      const decision = decided(result);
      const events = await repos.listEvents(p.t.db, p.organizationId, {
        invoiceId: result.invoice.id,
      });
      expect(statusFromEvents(events)).toBe(result.invoice.status);
      const types = [...events].reverse().map((e) => e.type);
      expect(types.slice(0, 2)).toEqual(["invoice.received", "invoice.processing"]);
      expect(new Set(events.map((e) => e.trace_id)).size).toBe(1);
      const final = events.find((e) => e.decision_id === decision.id);
      expect(final?.data["policy_hash"]).toBe(p.policyVersion.content_hash);
    }
    const notifications = await repos.listNotifications(p.t.db, p.organizationId);
    expect(notifications).toHaveLength(results.size);
    expect(notifications.every((n) => n.channel === "pantalla" && n.status === "pendiente")).toBe(
      true,
    );
  });

  it("el mismo archivo por otra entrega se frena como duplicado sin volver a llamar al modelo", async () => {
    const dup = decided(results.get("dup_exacto"));
    expect(dup.verdict).toBe("frenar");
    const calls = await repos.listLlmCalls(p.t.db, p.organizationId, dup.invoice_id);
    expect(calls).toHaveLength(0);
    const original = results.get("nube_oct");
    expect(original?.invoice.document_hash).toBe(results.get("dup_exacto")?.invoice.document_hash);
  });
});

describe("idempotencia y rechazos", () => {
  let p: Pipeline;
  afterEach(async () => {
    await p.close();
  });

  it("P-46 la misma entrega dos veces es una sola factura y una sola lectura", async () => {
    p = await openPipeline();
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const first = await processInvoice(p.deps, p.input(f.bytes, "upload:clave-1"));
    const second = await processInvoice(p.deps, p.input(f.bytes, "upload:clave-1"));
    expect(first.kind).toBe("decided");
    expect(second.kind).toBe("already_received");
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(second.decision?.id).toBe(decided(first).id);
    expect(p.client.requests).toHaveLength(1);
    const all = await repos.listInvoicesByDocumentHash(
      p.t.db,
      p.organizationId,
      first.invoice.document_hash,
    );
    expect(all).toHaveLength(1);
  });

  it("entregas simultáneas con la misma llave: una procesa, la otra recibe la existente", async () => {
    p = await openPipeline();
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const both = await Promise.all([
      processInvoice(p.deps, p.input(f.bytes, "upload:carrera")),
      processInvoice(p.deps, p.input(f.bytes, "upload:carrera")),
    ]);
    expect(both.map((r) => r.kind).sort()).toEqual(["already_received", "decided"]);
    expect(both[0]?.invoice.id).toBe(both[1]?.invoice.id);
  });

  it("una entrega vacía o de otro tipo se rechaza sin registrar factura", async () => {
    p = await openPipeline();
    const rejected = await processInvoice(p.deps, p.input(new Uint8Array(0), "upload:vacia")).catch(
      (e: unknown) => e,
    );
    expect(rejected).toBeInstanceOf(UseCaseError);
    if (rejected instanceof UseCaseError) {
      expect(rejected.code).toBe("rejected_document");
      expect(rejected.action.length).toBeGreaterThan(5);
    }
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array<number>(64).fill(0)]);
    await expect(processInvoice(p.deps, p.input(exe, "upload:exe"))).rejects.toMatchObject({
      code: "rejected_document",
    });
    expect(await repos.listInvoices(p.t.db, p.organizationId)).toHaveLength(24);
  });

  it("sin política vigente no se procesa nada (invariante 11)", async () => {
    p = await openPipeline();
    const orgId = p.t.newId();
    const org = await repos.getOrganization(p.t.db, p.organizationId);
    await repos.createOrganization(p.t.db, { ...org, id: orgId, demo_visitor_id: "sin-politica" });
    const f = await datasetCase("camila_oct");
    await expect(
      processInvoice(p.deps, { ...p.input(f.bytes, "upload:x"), organizationId: orgId }),
    ).rejects.toMatchObject({ code: "policy_missing" });
    await expect(
      processInvoice(p.deps, { ...p.input(f.bytes, "upload:y"), organizationId: p.t.newId() }),
    ).rejects.toMatchObject({ code: "organization_not_found" });
  });
});

describe("controles de la política (P-84, P-85)", () => {
  let p: Pipeline;
  afterEach(async () => {
    await p.close();
  });

  it("P-84 con modo de prueba se registra pagar sin orden y sin comprometer presupuesto ni saldo", async () => {
    p = await openPipeline();
    await setControls(p, { dry_run: true });
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const before = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    const balancesBefore = await repos.listBalances(p.t.db, p.organizationId);
    const decision = decided(await processInvoice(p.deps, p.input(f.bytes, "upload:prueba")));
    expect(decision.verdict).toBe("pagar");
    expect(decision.dry_run).toBe(true);
    expect(decision.payment_order).toBeNull();
    expect(decision.scheduled_for).not.toBeNull();
    const after = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    expect(after?.committed).toBe(before?.committed);
    expect(await repos.listBalances(p.t.db, p.organizationId)).toEqual(balancesBefore);
  });

  it("P-85 con autonomía recomendar nada se paga: lo que pagaría escala con autonomy_recomendar", async () => {
    p = await openPipeline();
    await setControls(p, { autonomy: "recomendar" });
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const result = await processInvoice(p.deps, p.input(f.bytes, "upload:recomendar"));
    const decision = decided(result);
    expect(decision.verdict).toBe("escalar");
    expect(decidingFinding(decision)?.code).toBe("autonomy_recomendar");
    expect(result.invoice.status).toBe("esperando_aprobacion");
    expect(result.invoice.approval_expires_at).not.toBeNull();
  });

  it("con los pagos apagados lo que pagaría escala con payments_disabled", async () => {
    p = await openPipeline();
    await setControls(p, { payments_enabled: false });
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const decision = decided(await processInvoice(p.deps, p.input(f.bytes, "upload:apagado")));
    expect(decision.verdict).toBe("escalar");
    expect(decidingFinding(decision)?.code).toBe("payments_disabled");
  });
});

describe("transacción de la decisión y presupuesto (P-81)", () => {
  let p: Pipeline;
  afterEach(async () => {
    await p.close();
  });

  it("si la reserva falla no queda decisión de pago: la factura escala por error de registro", async () => {
    p = await openPipeline();
    // Simula que otra decisión comprometió el presupuesto justo antes de escribir: el
    // UPDATE condicional no afecta filas.
    await p.t.db.run(
      sql.raw(
        "CREATE TRIGGER ledger_carrera BEFORE UPDATE OF committed ON ledger_periods BEGIN SELECT RAISE(IGNORE); END",
      ),
    );
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const balancesBefore = await repos.listBalances(p.t.db, p.organizationId);
    const result = await processInvoice(p.deps, p.input(f.bytes, "upload:carrera"));
    const decision = decided(result);
    expect(decision.verdict).toBe("escalar");
    expect(decision.findings[0]?.code).toBe("processing_error");
    expect(decision.findings[0]?.observed).toContain("registro");
    const all = await repos.listDecisions(p.t.db, p.organizationId, result.invoice.id);
    expect(all.map((d) => d.verdict)).toEqual(["escalar"]);
    expect(await repos.listBalances(p.t.db, p.organizationId)).toEqual(balancesBefore);
  });

  it("dos facturas simultáneas que no caben juntas en el presupuesto: una paga y la otra se frena", async () => {
    p = await openPipeline();
    const fixtures = await Promise.all([datasetCase("camila_oct"), datasetCase("lucia_oct")]);
    const org = await repos.getOrganization(p.t.db, p.organizationId);
    const usd = fixtures.map(({ case: c }) => {
      const { currency, total } = c.document;
      if (!isSupportedCurrency(currency)) throw new Error(`moneda ${currency}`);
      return toUsd({ amount: total, currency }, org.fx).amount;
    });
    const period = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    if (!period) throw new Error("sin periodo");
    // Deja libre lo justo para la mayor de las dos: cada una cabe sola, las dos juntas no.
    const free = Math.max(...usd) + 1;
    await repos.reserveBudget(
      p.t.db,
      p.organizationId,
      "2026-10",
      "USD",
      period.limit - period.committed - free,
      p.t.now().toISOString(),
    );
    for (const f of fixtures) p.client.routes.set(f.case.document.invoice_number, f.modelOutput);

    const results = await Promise.all(
      fixtures.map((f) => processInvoice(p.deps, p.input(f.bytes, `upload:${f.case.id}`))),
    );

    const decisions = results.map(decided);
    expect(decisions.map((d) => d.verdict).sort()).toEqual(["frenar", "pagar"]);
    const stopped = decisions.find((d) => d.verdict === "frenar");
    expect(stopped && decidingFinding(stopped)?.code).toBe("budget_exceeded");
    const after = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    expect((after?.committed ?? 0) <= (after?.limit ?? 0)).toBe(true);
  });
});
