import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadInbox, processInvoice, type Inbox } from "@/src/usecases";

import { datasetCases, openPipeline, type CaseFixture, type Pipeline } from "./helpers";

/**
 * P-101: con el dataset procesado, Pendientes muestra exactamente las escaladas (por
 * vencimiento), las frenadas y las pagadas del día; el historial de meses anteriores no
 * aparece, y el contador de la barra es el largo de la primera sección.
 */
describe("bandeja de pendientes sobre el dataset (P-101)", () => {
  let p: Pipeline;
  let fixtures: CaseFixture[];
  let inbox: Inbox;
  const idByCase = new Map<string, string>();

  beforeAll(async () => {
    p = await openPipeline();
    fixtures = await datasetCases();
    for (const f of fixtures) {
      p.client.next = f.modelOutput;
      const result = await processInvoice(p.deps, {
        ...p.input(f.bytes, `batch:${f.case.id}`, f.fileName),
        channel: "batch",
      });
      idByCase.set(f.case.id, result.invoice.id);
    }
    inbox = await loadInbox(p.t.db, p.organizationId, {
      // El reloj de prueba arranca el 17 a mediodía UTC: el día de Bogotá empezó a las 05:00.
      decidedSince: "2026-10-17T05:00:00.000Z",
      now: new Date("2026-10-17T20:00:00.000Z"),
    });
  }, 180_000);

  afterAll(async () => {
    await p.close();
  });

  const expectedIds = (verdict: string) =>
    fixtures.filter((f) => f.case.expected.verdict === verdict).map((f) => idByCase.get(f.case.id));

  it("esperan tu decisión: exactamente las escaladas, ordenadas por vencimiento", () => {
    expect(new Set(inbox.waiting.map((r) => r.invoiceId))).toEqual(new Set(expectedIds("escalar")));
    const dues = inbox.waiting.map((r) => r.dueDate);
    const withDate = dues.filter((d): d is string => d !== null);
    expect(withDate).toEqual([...withDate].sort());
    // Las que no tienen vencimiento van al final.
    expect(dues.slice(withDate.length).every((d) => d === null)).toBe(true);
    expect(inbox.waiting.every((r) => r.rule !== null && r.policyVersion === 1)).toBe(true);
  });

  it("frenadas y pagadas del día: exactamente las del dataset, sin el historial", () => {
    expect(new Set(inbox.stopped.map((r) => r.invoiceId))).toEqual(new Set(expectedIds("frenar")));
    expect(new Set(inbox.paid.map((r) => r.invoiceId))).toEqual(new Set(expectedIds("pagar")));
    expect(inbox.paid.every((r) => r.rule === null)).toBe(true);
  });

  it("cada fila trae beneficiario, monto y regla para la pantalla", () => {
    const unknown = inbox.waiting.find((r) => r.invoiceId === idByCase.get("beneficiario_nuevo"));
    expect(unknown?.payeeName).toBeTruthy();
    expect(unknown?.rule?.code).toBe("payee_not_allowed");
    const duplicate = inbox.stopped.find((r) => r.invoiceId === idByCase.get("dup_exacto"));
    expect(duplicate?.rule?.code).toBe("duplicate_invoice");
    expect(duplicate?.amount).toEqual({ amount: 480_000_000, currency: "COP" });
  });

  it("otra empresa no ve nada de esta", async () => {
    const other = await loadInbox(p.t.db, p.t.newId(), {
      decidedSince: "2026-10-17T05:00:00.000Z",
      now: new Date("2026-10-17T20:00:00.000Z"),
    });
    expect(other).toEqual({ waiting: [], stopped: [], paid: [] });
  });
});
