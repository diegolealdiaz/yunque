import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { healthRows } from "@/src/ui/health";
import { checkHealth, processInvoice, type HealthInput } from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-120: la salud se pone en rojo si falta la base, la política o el proveedor, y en ámbar si
 * hay escaladas vencidas o avisos sin entregar.
 */
let p: Pipeline;
const ids = new Map<string, string>();
const references = new Map<string, string>();

beforeAll(async () => {
  p = await openPipeline();
  for (const id of ["nube_oct", "sobre_umbral", "inyeccion"]) {
    const f = await datasetCase(id);
    p.client.next = f.modelOutput;
    const result = await processInvoice(p.deps, {
      ...p.input(f.bytes, `batch:${id}`, f.fileName),
      channel: "batch",
    });
    ids.set(id, result.invoice.id);
    references.set(id, result.invoice.reference);
  }
}, 120_000);

afterAll(async () => {
  await p.close();
});

describe("salud (P-120)", () => {
  function input(overrides: Partial<HealthInput> = {}): HealthInput {
    return {
      db: p.t.db,
      organizationId: p.organizationId,
      templateReady: () => Promise.resolve(true),
      model: { primary: "anthropic/claude-haiku-5.5" },
      now: new Date("2026-10-17T13:00:00.000Z"),
      ...overrides,
    };
  }

  it("en orden con base, política y proveedor; informa el pendiente más viejo", async () => {
    const report = await checkHealth(input());
    expect(report.status).toBe("ok");
    expect(report.policy.version).toBeGreaterThan(0);
    expect(report.operation?.waiting).toBe(1);
    expect(report.operation?.oldestWaitingSince).not.toBeNull();
    const rows = healthRows(report, new Date(report.checkedAt));
    expect(rows.map((r) => r.key)).toEqual([
      "base",
      "politica",
      "proveedor",
      "pendiente",
      "escaladas",
      "avisos",
    ]);
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it("rojo si falla la base, falta la política o falta el proveedor", async () => {
    const noDb = await checkHealth(input({ db: null, connectError: "LibsqlError" }));
    expect(noDb.status).toBe("falla");
    expect(noDb.database).toMatchObject({ ok: false, error: "LibsqlError" });

    const orgId = p.t.newId();
    const org = await repos.getOrganization(p.t.db, p.organizationId);
    await repos.createOrganization(p.t.db, { ...org, id: orgId, demo_visitor_id: "sin-politica" });
    const noPolicy = await checkHealth(input({ organizationId: orgId }));
    expect(noPolicy.status).toBe("falla");
    expect(noPolicy.policy.ok).toBe(false);

    const noModel = await checkHealth(input({ model: null }));
    expect(noModel.status).toBe("falla");
    expect(healthRows(noModel, new Date()).find((r) => r.key === "proveedor")?.detail).toContain(
      "Sin clave",
    );
  });

  it("rojo si la última llamada al proveedor falló hace poco; en orden cuando ya pasó", async () => {
    const at = new Date("2026-10-17T12:50:00.000Z");
    await repos.insertLlmCall(p.t.db, {
      id: p.t.newId(),
      organization_id: p.organizationId,
      invoice_id: null,
      model: "anthropic/claude-haiku-5.5",
      prompt_version: "lector-v3",
      prompt_hash: "h",
      raw_output: null,
      attempt: 1,
      input_tokens: null,
      output_tokens: null,
      cost_usd_micros: 0,
      latency_ms: 30_000,
      status: "error",
      error: "plazo vencido",
      trace_id: "tr-salud",
      created_at: at.toISOString(),
    });
    const recent = await checkHealth(input());
    expect(recent.status).toBe("falla");
    expect(recent.model.lastCall?.error).toBe("plazo vencido");
    const later = await checkHealth(input({ now: new Date(at.getTime() + 60 * 60_000) }));
    expect(later.model.ok).toBe(true);
  });

  it("ámbar con escaladas vencidas o avisos sin entregar", async () => {
    const now = new Date("2026-11-30T12:00:00.000Z");
    const expired = await checkHealth(input({ now }));
    expect(expired.status).toBe("degradada");
    expect(expired.operation?.expired).toBe(1);

    await repos.enqueueNotification(p.t.db, {
      id: p.t.newId(),
      organization_id: p.organizationId,
      channel: "telegram",
      idempotency_key: "salud-aviso",
      payload: {},
      status: "fallida",
      attempts: 5,
      next_attempt_at: null,
      last_error: "sin destino",
      created_at: "2026-10-17T12:00:00.000Z",
      updated_at: "2026-10-17T12:00:00.000Z",
    });
    // Más de media hora después de la llamada fallida de la prueba anterior: el proveedor ya
    // no cuenta como caído y lo único que queda es el aviso.
    const report = await checkHealth(input({ now: new Date("2026-10-17T13:30:00.000Z") }));
    expect(report.status).toBe("degradada");
    expect(report.operation?.failedNotifications).toBe(1);
  });

  it("sin empresa todavía solo revisa lo del sistema", async () => {
    const report = await checkHealth(input({ organizationId: null }));
    expect(report.status).toBe("ok");
    expect(report.operation).toBeNull();
    const broken = await checkHealth(
      input({ organizationId: null, templateReady: () => Promise.resolve(false) }),
    );
    expect(broken.status).toBe("falla");
  });
});
