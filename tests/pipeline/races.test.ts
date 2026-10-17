import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { PolicySchema, receiptKeyFor, type Decision } from "@/src/domain";
import { decidingFinding } from "@/src/engine";
import { processInvoice, type ProcessInvoiceResult } from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * Lo que puede cambiar mientras una factura se procesa, y cómo se recupera una que quedó a
 * medias. Cierra los huecos de la revisión de la Fase 4.
 */

function decided(result: ProcessInvoiceResult | undefined): Decision {
  if (result?.kind !== "decided")
    throw new Error(`se esperaba una decisión, llegó ${String(result?.kind)}`);
  return result.decision;
}

describe("carreras entre decisiones (P-46, P-81)", () => {
  let p: Pipeline;
  afterEach(async () => {
    await p.close();
  });

  it("dos archivos distintos del mismo cobro procesados a la vez: uno paga y el otro se frena", async () => {
    p = await openPipeline();
    const pdf = await datasetCase("nube_oct");
    const scan = await datasetCase("dup_otro_formato");
    // El PDF trae texto y se enruta por su número; el escaneado no tiene texto y cae en `next`.
    p.client.routes.set(pdf.case.document.invoice_number, pdf.modelOutput);
    p.client.next = scan.modelOutput;

    const results = await Promise.all([
      processInvoice(p.deps, p.input(pdf.bytes, "upload:pdf")),
      processInvoice(p.deps, p.input(scan.bytes, "upload:escaneo", "escaneo.png")),
    ]);

    const decisions = results.map(decided);
    expect(decisions.map((d) => d.verdict).sort()).toEqual(["frenar", "pagar"]);
    const stopped = decisions.find((d) => d.verdict === "frenar");
    expect(stopped && decidingFinding(stopped)?.code).toBe("duplicate_invoice");
  });

  it("si apagan los pagos mientras la factura se lee, la decisión usa la política nueva", async () => {
    p = await openPipeline({
      wrapReader: (inner, t) => ({
        async read(doc, context) {
          const result = await inner.read(doc, context);
          const current = await repos.getCurrentPolicy(t.db, context.organizationId);
          if (!current) throw new Error("sin política");
          const content = PolicySchema.parse({
            ...current.content,
            controls: { ...current.content.controls, payments_enabled: false },
          });
          await repos.appendPolicyVersion(
            t.db,
            context.organizationId,
            { content, signedBy: "Ana Torres", signedAt: t.now().toISOString() },
            t.newId,
          );
          return result;
        },
      }),
    });
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const decision = decided(await processInvoice(p.deps, p.input(f.bytes, "upload:apagan")));
    expect(decision.verdict).toBe("escalar");
    expect(decidingFinding(decision)?.code).toBe("payments_disabled");
    const current = await repos.getCurrentPolicy(p.t.db, p.organizationId);
    expect(decision.policy_version_id).toBe(current?.id);
  });
});

describe("recuperación de facturas a medias", () => {
  let p: Pipeline;
  afterEach(async () => {
    await p.close();
  });

  it("una factura fallida se reintenta reenviando la misma entrega", async () => {
    p = await openPipeline();
    await p.t.db.run(
      sql.raw(
        "CREATE TRIGGER decisiones_caidas BEFORE INSERT ON decisions BEGIN SELECT RAISE(ABORT, 'prueba'); END",
      ),
    );
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    await expect(
      processInvoice(p.deps, p.input(f.bytes, "upload:reintento")),
    ).rejects.toMatchObject({
      code: "record_failed",
      action: expect.stringContaining("misma factura"),
    });
    await p.t.db.run(sql.raw("DROP TRIGGER decisiones_caidas"));

    const retried = await processInvoice(p.deps, p.input(f.bytes, "upload:reintento"));
    expect(decided(retried).verdict).toBe("pagar");
    expect(retried.invoice.status).toBe("decidida");
    const events = await repos.listEvents(p.t.db, p.organizationId, {
      invoiceId: retried.invoice.id,
    });
    expect(events.some((e) => e.type === "invoice.processing" && e.data["retry"] === true)).toBe(
      true,
    );
  });

  it("una factura abandonada en procesando vence y se retoma; una reciente no se toca", async () => {
    p = await openPipeline();
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const first = await processInvoice(p.deps, p.input(f.bytes, "upload:colgada"));
    // Simula una función que murió a mitad: la factura sigue en `procesando`.
    await p.t.db.run(
      sql`UPDATE invoices SET status = 'procesando', updated_at = ${p.t.now().toISOString()} WHERE id = ${first.invoice.id}`,
    );
    const recent = await processInvoice(p.deps, p.input(f.bytes, "upload:colgada"));
    expect(recent.kind).toBe("already_received");

    await p.t.db.run(
      sql`UPDATE invoices SET updated_at = '2026-10-01T00:00:00.000Z' WHERE id = ${first.invoice.id}`,
    );
    const resumed = await processInvoice(p.deps, p.input(f.bytes, "upload:colgada"));
    expect(resumed.kind).toBe("decided");
    const events = await repos.listEvents(p.t.db, p.organizationId, {
      invoiceId: first.invoice.id,
    });
    expect(events.some((e) => e.type === "invoice.failed")).toBe(true);
  });

  it("reintentar una entrega con otro documento se rechaza", async () => {
    p = await openPipeline();
    const corrupt = new TextEncoder().encode("%PDF-1.7\nroto");
    await p.t.db.run(
      sql.raw(
        "CREATE TRIGGER decisiones_caidas BEFORE INSERT ON decisions BEGIN SELECT RAISE(ABORT, 'prueba'); END",
      ),
    );
    await expect(processInvoice(p.deps, p.input(corrupt, "upload:otra"))).rejects.toMatchObject({
      code: "record_failed",
    });
    const f = await datasetCase("camila_oct");
    await expect(processInvoice(p.deps, p.input(f.bytes, "upload:otra"))).rejects.toMatchObject({
      code: "rejected_document",
    });
  });
});

describe("modo de prueba y llaves de recepción", () => {
  let p: Pipeline;
  afterEach(async () => {
    await p.close();
  });

  it("un pagar en modo de prueba queda como simulado en el historial: no habilita pagos reales", async () => {
    p = await openPipeline();
    const current = p.policyVersion.content;
    await repos.appendPolicyVersion(
      p.t.db,
      p.organizationId,
      {
        content: PolicySchema.parse({
          ...current,
          controls: { ...current.controls, dry_run: true },
        }),
        signedBy: "Ana Torres",
        signedAt: p.t.now().toISOString(),
      },
      p.t.newId,
    );
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const decision = decided(await processInvoice(p.deps, p.input(f.bytes, "upload:simulada")));
    expect(decision.verdict).toBe("pagar");
    const prior = await repos.listPriorInvoices(p.t.db, p.organizationId, {
      vendorId: decision.vendor_id,
      semanticKey: null,
      documentHash: decision.document_hash,
      excludeInvoiceId: p.t.newId(),
    });
    expect(prior.find((r) => r.invoice_id === decision.invoice_id)?.outcome).toBe("simulada");
  });

  it("una llave mal formada se rechaza antes de guardar nada; receiptKeyFor la vuelve válida", async () => {
    p = await openPipeline();
    const f = await datasetCase("camila_oct");
    const messageId = "<CAF=abc123@mail.ejemplo.co>";
    await expect(
      processInvoice(p.deps, p.input(f.bytes, `inbox:${messageId}`)),
    ).rejects.toMatchObject({ code: "rejected_document" });
    expect(p.storage.files.size).toBe(0);
    const key = receiptKeyFor("inbox", messageId);
    expect(key).toMatch(/^inbox:h-[0-9a-f]{40}$/);
    expect(receiptKeyFor("inbox", messageId)).toBe(key);
    expect(receiptKeyFor("batch", "nube_oct")).toBe("batch:nube_oct");
  });
});
