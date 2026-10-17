import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { loadAuditLog, processInvoice, savePolicy } from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-109: la bitácora muestra cada transición del pipeline y filtra por tipo, factura y
 * persona sin salirse de la empresa.
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

describe("bitácora (P-109)", () => {
  it("cada transición del pipeline queda como evento de su factura", async () => {
    const log = await loadAuditLog(p.t.db, p.organizationId, {
      invoice: references.get("sobre_umbral") ?? "",
    });
    const types = log.entries.map((e) => e.event.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "invoice.received",
        "invoice.processing",
        "invoice.normalized",
        "invoice.extracted",
        "invoice.escalated",
      ]),
    );
    // Solo eventos de esa factura, cada uno con su referencia para enlazarla.
    expect(
      log.entries.every(
        (e) =>
          e.event.invoice_id === ids.get("sobre_umbral") &&
          e.invoiceReference === references.get("sobre_umbral"),
      ),
    ).toBe(true);
  });

  it("la factura se busca por referencia, sin importar mayúsculas, o por id", async () => {
    const reference = references.get("nube_oct") ?? "";
    const byReference = await loadAuditLog(p.t.db, p.organizationId, {
      invoice: ` ${reference.toLowerCase()} `,
    });
    const byId = await loadAuditLog(p.t.db, p.organizationId, { invoice: ids.get("nube_oct") });
    expect(byReference.entries.length).toBeGreaterThan(0);
    expect(byId.entries.map((e) => e.event.id)).toEqual(byReference.entries.map((e) => e.event.id));
  });

  it("filtra por tipo y por persona", async () => {
    const decided = await loadAuditLog(p.t.db, p.organizationId, { type: "invoice.decided" });
    expect(decided.entries.every((e) => e.event.type === "invoice.decided")).toBe(true);
    // Las dos decididas del lote están; la escalada no, porque su evento es otro tipo.
    const decidedInvoices = decided.entries.map((e) => e.event.invoice_id);
    expect(decidedInvoices).toEqual(
      expect.arrayContaining([ids.get("nube_oct"), ids.get("inyeccion")]),
    );
    expect(decidedInvoices).not.toContain(ids.get("sobre_umbral"));

    const current = await repos.getCurrentPolicy(p.t.db, p.organizationId);
    if (!current) throw new Error("sin política");
    await savePolicy(
      {
        db: p.t.db,
        newId: p.t.newId,
        now: p.t.now,
        timeZone: "America/Bogota",
        businessDate: "2026-10-17",
      },
      {
        organizationId: p.organizationId,
        candidate: current.content,
        signedBy: "Diego Leal",
        note: null,
      },
    );
    const person = await loadAuditLog(p.t.db, p.organizationId, { person: "Diego Leal" });
    expect(person.entries.map((e) => e.event.type)).toEqual(
      expect.arrayContaining(["policy.saved", "policy.replayed"]),
    );
    expect(
      person.entries.every(
        (e) => e.event.actor.kind === "humano" && e.event.actor.name === "Diego Leal",
      ),
    ).toBe(true);
    const agent = await loadAuditLog(p.t.db, p.organizationId, { person: "agente" });
    expect(agent.entries.every((e) => e.event.actor.kind === "agente")).toBe(true);
    expect(person.people).toContain("Diego Leal");
  });

  it("pagina sin contar la tabla, y no ve facturas de otra empresa", async () => {
    const page = await loadAuditLog(p.t.db, p.organizationId, { limit: 3 });
    expect(page.entries).toHaveLength(3);
    expect(page.hasMore).toBe(true);

    const other = await openPipeline();
    try {
      const missing = await loadAuditLog(other.t.db, other.organizationId, {
        invoice: ids.get("nube_oct"),
      });
      expect(missing.invoiceNotFound).toBe(true);
      expect(missing.entries).toHaveLength(0);
      // Otra base: mismo id de factura no existe; en la misma base, otra empresa tampoco la ve.
      const sameDbOtherOrg = p.t.newId();
      const org = await repos.getOrganization(p.t.db, p.organizationId);
      await repos.createOrganization(p.t.db, {
        ...org,
        id: sameDbOtherOrg,
        demo_visitor_id: "otra",
      });
      const isolated = await loadAuditLog(p.t.db, sameDbOtherOrg, {
        invoice: references.get("nube_oct"),
      });
      expect(isolated.invoiceNotFound).toBe(true);
    } finally {
      await other.close();
    }
  });
});
