import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import type { Decision } from "@/src/domain";
import { decidingFinding } from "@/src/engine";
import { ModelError } from "@/src/extraction";
import { NO_MODEL, UseCaseError, processInvoice, type ProcessInvoiceResult } from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-82: un error en cualquier etapa deja la factura en `escalar` con el hallazgo del error
 * y su evento. Nunca `pagar`, nunca un estado intermedio. Si ni eso se puede registrar, la
 * factura queda `fallida` para reintentarla.
 */

function decided(result: ProcessInvoiceResult): Decision {
  if (result.kind !== "decided") throw new Error(`se esperaba una decisión, llegó ${result.kind}`);
  return result.decision;
}

/** Comprueba el escalado por error: hallazgo, estado, evento y ninguna decisión de pago. */
async function expectEscalatedAt(p: Pipeline, result: ProcessInvoiceResult, stage: string) {
  const decision = decided(result);
  expect(decision.verdict).toBe("escalar");
  expect(decision.findings.map((f) => f.code)).toEqual(["processing_error"]);
  expect(decision.findings[0]?.observed).toContain(stage);
  expect(decision.explanation).toContain("processing_error");
  expect(result.invoice.status).toBe("esperando_aprobacion");
  const events = await repos.listEvents(p.t.db, p.organizationId, { invoiceId: result.invoice.id });
  const escalated = events.find((e) => e.type === "invoice.escalated");
  expect(escalated?.decision_id).toBe(decision.id);
  expect(escalated?.data["error"]).toBeDefined();
  const all = await repos.listDecisions(p.t.db, p.organizationId, result.invoice.id);
  expect(all.some((d) => d.verdict === "pagar")).toBe(false);
}

describe("errores por etapa (P-82)", () => {
  let p: Pipeline;
  afterEach(async () => {
    await p.close();
  });

  it("normalización: un PDF que no abre escala y el original queda guardado", async () => {
    p = await openPipeline();
    const corrupt = new TextEncoder().encode("%PDF-1.7\nesto no es un pdf");
    const result = await processInvoice(p.deps, p.input(corrupt, "upload:roto"));
    await expectEscalatedAt(p, result, "normalización");
    expect(decided(result).findings[0]?.observed).toContain("corrupt_document");
    expect(p.storage.files.has(result.invoice.file_key)).toBe(true);
    expect(p.client.requests).toHaveLength(0);
  });

  it("lectura: un Lector que lanza escala por error de proceso", async () => {
    p = await openPipeline({
      reader: { read: () => Promise.reject(new Error("almacenamiento caído")) },
    });
    const f = await datasetCase("camila_oct");
    const result = await processInvoice(p.deps, p.input(f.bytes, "upload:lector"));
    await expectEscalatedAt(p, result, "lectura");
    // El texto de un error desconocido no se expone en el hallazgo.
    expect(decided(result).findings[0]?.message).not.toContain("almacenamiento");
  });

  it("modelo: un error terminal del proveedor deja la factura ilegible, que escala", async () => {
    p = await openPipeline();
    p.client.next = new ModelError("provider", "401: clave inválida", false);
    const f = await datasetCase("camila_oct");
    const decision = decided(await processInvoice(p.deps, p.input(f.bytes, "upload:401")));
    expect(decision.verdict).toBe("escalar");
    expect(decidingFinding(decision)?.code).toBe("extraction_unreadable");
    // Un 401 no se reintenta y no hay segunda pasada que valga: el respaldo también falla.
    const calls = await repos.listLlmCalls(p.t.db, p.organizationId, decision.invoice_id);
    expect(calls.every((c) => c.status === "error")).toBe(true);
    expect(calls[0]?.error).toContain("401");
  });

  it("sin clave del modelo: la factura escala como ilegible y el Detector frena las inyecciones", async () => {
    p = await openPipeline({ reader: null });
    const normal = await datasetCase("camila_oct");
    const unread = decided(await processInvoice(p.deps, p.input(normal.bytes, "upload:sin-1")));
    expect(unread.verdict).toBe("escalar");
    expect(decidingFinding(unread)?.code).toBe("extraction_unreadable");
    const stored = await repos.getLatestExtraction(p.t.db, p.organizationId, unread.invoice_id);
    expect(stored?.record.model).toBe(NO_MODEL);

    const injected = await datasetCase("inyeccion");
    const stopped = decided(await processInvoice(p.deps, p.input(injected.bytes, "upload:sin-2")));
    expect(stopped.verdict).toBe("frenar");
    expect(decidingFinding(stopped)?.code).toBe("suspicious_instructions");
  });

  it("resolución: una lista de vendors corrupta escala, no se adivina", async () => {
    p = await openPipeline();
    await p.t.db.run(sql`UPDATE vendors SET account = '{}'`);
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const result = await processInvoice(p.deps, p.input(f.bytes, "upload:vendors"));
    await expectEscalatedAt(p, result, "resolución");
  });

  it("evaluación: un historial corrupto detiene la decisión en voz alta", async () => {
    p = await openPipeline();
    await p.t.db.run(
      sql`UPDATE invoices SET status = 'desconocido' WHERE receipt_key LIKE 'seed:%'`,
    );
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const result = await processInvoice(p.deps, p.input(f.bytes, "upload:historial"));
    await expectEscalatedAt(p, result, "evaluación");
  });

  it("si ni el escalado se puede escribir, la factura queda fallida con su evento", async () => {
    p = await openPipeline();
    await p.t.db.run(
      sql.raw(
        "CREATE TRIGGER decisiones_caidas BEFORE INSERT ON decisions BEGIN SELECT RAISE(ABORT, 'prueba'); END",
      ),
    );
    const f = await datasetCase("camila_oct");
    p.client.next = f.modelOutput;
    const error = await processInvoice(p.deps, p.input(f.bytes, "upload:caida")).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UseCaseError);
    if (error instanceof UseCaseError) {
      expect(error.code).toBe("record_failed");
      expect(error.retryable).toBe(true);
    }
    const invoice = await repos.findInvoiceByReceiptKey(p.t.db, p.organizationId, "upload:caida");
    expect(invoice?.status).toBe("fallida");
    const events = await repos.listEvents(p.t.db, p.organizationId, {
      invoiceId: invoice?.id ?? "",
    });
    expect(events[0]?.type).toBe("invoice.failed");
    expect(await repos.getLatestDecision(p.t.db, p.organizationId, invoice?.id ?? "")).toBeNull();
  });
});
