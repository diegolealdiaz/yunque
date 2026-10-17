import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listEvents } from "@/src/db/repositories";
import { timelineLines } from "@/src/ui/timeline";
import {
  loadExplanationRating,
  loadInvoiceDetail,
  processInvoice,
  rateExplanation,
} from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-142: "¿Fue clara la explicación?". La opinión queda en la bitácora sin tocar la
 * decisión; la más reciente es la que cuenta, y solo se opina sobre la decisión vigente.
 */
describe("opinión sobre la explicación (P-142)", () => {
  let p: Pipeline;
  let invoiceId = "";
  let decisionId = "";
  const NOW = new Date("2026-10-17T12:00:00.000Z");
  const actor = { kind: "humano", name: "Ana Torres" } as const;

  beforeAll(async () => {
    p = await openPipeline();
    const f = await datasetCase("sobre_umbral");
    p.client.next = f.modelOutput;
    const result = await processInvoice(p.deps, p.input(f.bytes, "batch:sobre_umbral", f.fileName));
    invoiceId = result.invoice.id;
    decisionId = result.decision?.id ?? "";
  }, 120_000);

  afterAll(async () => {
    await p.close();
  });

  const rate = (clear: boolean, comment?: string, id = decisionId) =>
    rateExplanation(p.t.db, {
      organizationId: p.organizationId,
      invoiceId,
      decisionId: id,
      rating: comment ? { clear, comment } : { clear },
      actor,
      newId: p.t.newId,
      now: NOW,
    });

  it("sin opiniones, no hay ninguna", async () => {
    expect(await loadExplanationRating(p.t.db, p.organizationId, invoiceId, decisionId)).toBeNull();
  });

  it("guarda la opinión como evento y la más reciente es la que cuenta", async () => {
    await rate(true);
    await rate(false, "  No entendí qué es el umbral  ");
    expect(await loadExplanationRating(p.t.db, p.organizationId, invoiceId, decisionId)).toEqual({
      clear: false,
      comment: "No entendí qué es el umbral",
    });
    const events = await listEvents(p.t.db, p.organizationId, {
      invoiceId,
      type: "explanation.rated",
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.actor).toEqual(actor);
    const detail = await loadInvoiceDetail(p.t.db, p.storage, p.organizationId, invoiceId);
    expect(timelineLines(detail.timeline).map((l) => l.label)).toContain("Explicación poco clara");
    // La decisión no cambia por opinar.
    expect(detail.decision?.id).toBe(decisionId);
  });

  it("no se opina sobre una decisión que no es la vigente", async () => {
    await expect(rate(true, undefined, p.t.newId())).rejects.toMatchObject({
      code: "decision_changed",
    });
  });

  it("un comentario demasiado largo no se guarda", async () => {
    await expect(rate(false, "x".repeat(501))).rejects.toThrow();
  });
});
