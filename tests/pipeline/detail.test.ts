import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DbError } from "@/src/db/errors";
import { timelineLines } from "@/src/ui/timeline";
import {
  approvalOffer,
  correctAndReevaluate,
  invoicePageKey,
  loadInvoiceDetail,
  pngSize,
  processInvoice,
  rateExplanation,
  rejectEscalation,
} from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-102: el detalle trae lo que la pantalla necesita para responder qué dice el documento,
 * qué decidió el agente y qué hace la persona; nada de otra empresa.
 */
describe("detalle de una decisión (P-102)", () => {
  let p: Pipeline;
  const ids = new Map<string, string>();

  beforeAll(async () => {
    p = await openPipeline();
    for (const id of [
      "nube_oct",
      "cuenta_distinta",
      "sobre_umbral",
      "joao_png",
      "adv_dos_totales",
    ]) {
      const f = await datasetCase(id);
      p.client.next = f.modelOutput;
      const result = await processInvoice(p.deps, p.input(f.bytes, `batch:${id}`, f.fileName));
      ids.set(id, result.invoice.id);
    }
  }, 120_000);

  afterAll(async () => {
    await p.close();
  });

  const load = (id: string) =>
    loadInvoiceDetail(p.t.db, p.storage, p.organizationId, ids.get(id) ?? "");

  it("las reglas que fallaron van primero, con su valor observado y su umbral", async () => {
    const detail = await load("cuenta_distinta");
    expect(detail.decision?.verdict).toBe("frenar");
    expect(detail.rules[0]?.code).toBe("bank_account_mismatch");
    expect(detail.rules[0]?.finding?.observed).toBeTruthy();
    expect(detail.rules[0]?.finding?.threshold).toBeTruthy();
    const firstPass = detail.rules.findIndex((r) => r.outcome !== "fail" && r.outcome !== "error");
    expect(detail.rules.slice(firstPass).every((r) => r.outcome !== "fail")).toBe(true);
    expect(detail.rules.length).toBeGreaterThan(15);
    // Frenada: no hay checklist, porque una persona no libera un freno sin reprocesar.
    expect(detail.checklist).toEqual([]);
  });

  it("cada campo leído trae su cita y, en un PDF, dónde está sobre la página", async () => {
    const detail = await load("nube_oct");
    const total = detail.fields.find((f) => f.name === "total");
    expect(total?.literal).toBe("4.800.000,00");
    expect(total?.box).not.toBeNull();
    expect(total?.box && total.box.x > 0.5 && total.box.y > 0.5).toBe(true);
    expect(detail.pages).toEqual([
      { number: 1, width: expect.any(Number), height: expect.any(Number) },
    ]);
    expect(detail.decision?.payment_order?.status).toBe("preparada_no_ejecutada");
    expect(detail.payeeName).toBe("Nube Andina SAS");
  });

  it("un escaneo sin capa de texto no tiene cajas, pero sí sus campos", async () => {
    const detail = await load("joao_png");
    expect(detail.fields.length).toBeGreaterThan(5);
    expect(detail.fields.every((f) => f.box === null)).toBe(true);
    const scan = await p.storage.get(detail.invoice.page_keys[0] ?? "");
    expect(detail.pages[0]).toEqual({ number: 1, ...pngSize(scan) });
  });

  it("una escalada trae su checklist y la firma en claro, con el monto formateado", async () => {
    const detail = await load("sobre_umbral");
    expect(detail.decision?.verdict).toBe("escalar");
    expect(detail.checklist.map((c) => c.code)).toEqual([
      "amount_over_approval_threshold",
      "general",
    ]);
    expect(detail.signatureSummary).toMatch(/^doc [0-9a-f]{6}…, política v1, .+ COP a \*{4}\d{4}$/);
  });

  it("tras corregir un campo, la traza es la de la reevaluación, y un rechazo posterior se ve", async () => {
    const before = await load("adv_dos_totales");
    expect(before.rules.some((r) => r.finding?.code === "field_ambiguous")).toBe(true);
    const f = await datasetCase("adv_dos_totales");
    const invoiceId = ids.get("adv_dos_totales") ?? "";
    const decide = {
      db: p.t.db,
      newId: p.t.newId,
      now: p.t.now,
      timeZone: "America/Bogota",
      businessDate: "2026-10-17",
    };
    await correctAndReevaluate(decide, {
      organizationId: p.organizationId,
      invoiceId,
      actor: "Diego Leal",
      submitted: { total: (f.case.document.total / 100).toFixed(2) },
      confirmed: ["total"],
    });
    const after = await load("adv_dos_totales");
    expect(after.decision?.actor.kind).toBe("humano");
    expect(after.rulesFromEscalation).toBe(false);
    expect(after.rules.some((r) => r.finding?.code === "field_ambiguous")).toBe(false);

    // El rechazo queda sobre la decisión de la corrección: el detalle debe encontrarlo.
    expect(after.decision?.verdict).toBe("escalar");
    const resolution = { ...decide, signingSecret: "secreto-de-firma-de-prueba-0000000000000000" };
    const offer = await approvalOffer(resolution, p.organizationId, invoiceId);
    if (!offer) throw new Error("sin oferta");
    await rejectEscalation(resolution, {
      organizationId: p.organizationId,
      invoiceId,
      payload: offer.payload,
      signature: offer.signature,
      approver: "Ana Torres",
      reason: "No corresponde a un servicio recibido",
    });
    const rejected = await load("adv_dos_totales");
    expect(rejected.invoice.status).toBe("rechazada");
    expect(rejected.approval?.reason).toBe("No corresponde a un servicio recibido");
  });

  it("la línea de tiempo cuenta la historia en orden, sin eventos internos", async () => {
    const detail = await load("nube_oct");
    expect(timelineLines(detail.timeline).map((l) => l.label)).toEqual([
      "Recibida",
      "Normalizada",
      "Leída",
      "Pagada",
    ]);
  });

  it("una factura de otra empresa responde igual que una inexistente", async () => {
    await expect(
      loadInvoiceDetail(p.t.db, p.storage, p.t.newId(), ids.get("nube_oct") ?? ""),
    ).rejects.toBeInstanceOf(DbError);
  });

  it("la imagen de una página solo existe para la empresa dueña y para páginas reales", async () => {
    const id = ids.get("nube_oct") ?? "";
    expect(await invoicePageKey(p.t.db, p.organizationId, id, 1)).toMatch(/\.png$/);
    expect(await invoicePageKey(p.t.db, p.organizationId, id, 2)).toBeNull();
    expect(await invoicePageKey(p.t.db, p.t.newId(), id, 1)).toBeNull();
  });

  it("trae los aprobadores de la política vigente para resolver la escalada", async () => {
    const detail = await load("sobre_umbral");
    expect(detail.approvers).toEqual(p.policyVersion.content.protected.approvers);
  });

  it("pngSize lee el tamaño de la cabecera y rechaza lo que no es PNG", () => {
    expect(pngSize(new TextEncoder().encode("no es una imagen"))).toBeNull();
  });

  it("una pagada por el agente trae todos sus controles, aunque haya eventos más nuevos", async () => {
    const before = await load("nube_oct");
    if (!before.decision) throw new Error("sin decisión");
    // Un evento posterior de la misma decisión (aviso, opinión) no trae el registro del motor.
    await rateExplanation(p.t.db, {
      organizationId: p.organizationId,
      invoiceId: ids.get("nube_oct") ?? "",
      decisionId: before.decision.id,
      rating: { clear: true },
      actor: { kind: "humano", name: "Diego Leal" },
      newId: p.t.newId,
      now: new Date("2026-10-17T15:00:00.000Z"),
    });
    const detail = await load("nube_oct");
    expect(detail.decision?.verdict).toBe("pagar");
    expect(detail.rules.length).toBeGreaterThan(15);
    expect(detail.rules.every((r) => r.outcome !== "fail")).toBe(true);
  });
});
