import { afterEach, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { PolicySchema } from "@/src/domain";
import { decidingFinding } from "@/src/engine";
import {
  ApprovalError,
  CorrectionError,
  approvalOffer,
  approveEscalation,
  correctAndReevaluate,
  processInvoice,
  reevaluateWithCurrentPolicy,
  type DecideDeps,
} from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * Corrección de campos y reevaluación: la persona corrige, el motor vuelve a decidir con la
 * política vigente, nada se paga sin otra persona, y una reevaluación nunca ablanda.
 */

const SECRET = "secreto-de-firma-de-prueba-0000000000000000";
const CORRECTOR = "Diego Leal";
const SECOND = "Ana Torres";

let p: Pipeline;
afterEach(async () => {
  await p.close();
});

function deps(): DecideDeps {
  return {
    db: p.t.db,
    newId: p.t.newId,
    now: p.t.now,
    timeZone: "America/Bogota",
    businessDate: "2026-10-17",
  };
}

async function process(id: string): Promise<string> {
  const f = await datasetCase(id);
  p.client.next = f.modelOutput;
  return (await processInvoice(p.deps, p.input(f.bytes, `batch:${id}`, f.fileName))).invoice.id;
}

const codeOf = (error: unknown) =>
  error instanceof CorrectionError || error instanceof ApprovalError ? error.code : String(error);

async function approveAs(invoiceId: string, approver: string) {
  const resolution = { ...deps(), signingSecret: SECRET };
  const offer = await approvalOffer(resolution, p.organizationId, invoiceId);
  if (!offer) throw new Error("sin oferta");
  return approveEscalation(resolution, {
    organizationId: p.organizationId,
    invoiceId,
    payload: offer.payload,
    signature: offer.signature,
    approver,
    checkedCodes: offer.checklist.map((c) => c.code),
  });
}

describe("corregir campos de una escalada", () => {
  it("la persona fija el total ambiguo; el motor reevalúa y, por cuatro ojos, otra persona aprueba", async () => {
    p = await openPipeline();
    const id = await process("adv_dos_totales");
    const before = await repos.getLatestDecision(p.t.db, p.organizationId, id);
    expect(before && decidingFinding(before)?.code).toBe("field_ambiguous");
    const f = await datasetCase("adv_dos_totales");

    const corrected = await correctAndReevaluate(deps(), {
      organizationId: p.organizationId,
      invoiceId: id,
      actor: CORRECTOR,
      // El Lector leyó bien el total; la persona lo confirma frente al segundo total del documento.
      submitted: { total: (f.case.document.total / 100).toFixed(2) },
      confirmed: ["total"],
    });

    expect(corrected.decision.previous_decision_id).toBe(before?.id);
    expect(corrected.decision.actor).toEqual({ kind: "humano", name: CORRECTOR });
    expect(corrected.decision.field_sources.total).toBe("humano");
    expect(corrected.decision.verdict).toBe("escalar");
    expect(decidingFinding(corrected.decision)?.code).toBe("human_correction");
    const stored = await repos.getLatestExtraction(p.t.db, p.organizationId, id);
    expect(stored?.record.model).toBe("correccion-manual");

    // Quien corrigió no libera su propia corrección; otra persona de la lista sí.
    expect(await approveAs(id, CORRECTOR).catch(codeOf)).toBe("self_approval");
    const approved = await approveAs(id, SECOND);
    expect(approved.decision.verdict).toBe("pagar");
    expect(approved.decision.actor).toEqual({ kind: "humano", name: SECOND });

    const events = await repos.listEvents(p.t.db, p.organizationId, { invoiceId: id });
    const correctedEvent = events.find((e) => e.type === "invoice.corrected");
    expect(correctedEvent?.actor).toEqual({ kind: "humano", name: CORRECTOR });
    expect(correctedEvent?.data["fields"]).toEqual(["total"]);
  });

  it("valores inválidos, campos obligatorios vacíos, sin cambios o fuera de la lista: no se corrige", async () => {
    p = await openPipeline();
    const id = await process("adv_dos_totales");
    const correct = (submitted: Record<string, string>, actor: string | null = CORRECTOR) =>
      correctAndReevaluate(deps(), {
        organizationId: p.organizationId,
        invoiceId: id,
        actor,
        submitted,
      }).catch((e: unknown) =>
        e instanceof CorrectionError ? `${e.code}:${String(e.field)}` : String(e),
      );
    expect(await correct({ total: "mucho dinero" })).toBe("invalid_value:total");
    expect(await correct({ due_date: "31/02/2026" })).toBe("invalid_value:due_date");
    expect(await correct({ payee_name: "" })).toBe("missing_required:payee_name");
    expect(await correct({})).toBe("nothing_changed:null");
    expect(await correct({ total: "1.00" }, "Alguien Más")).toBe("not_authorized:null");
    expect((await repos.getInvoice(p.t.db, p.organizationId, id)).status).toBe(
      "esperando_aprobacion",
    );
  });

  it("un documento que no se pudo leer como factura se completa a mano con los cuatro campos obligatorios", async () => {
    p = await openPipeline();
    const id = await process("adv_no_es_factura");
    const missing = await correctAndReevaluate(deps(), {
      organizationId: p.organizationId,
      invoiceId: id,
      actor: CORRECTOR,
      submitted: { payee_name: "Nube Andina SAS" },
    }).catch(codeOf);
    expect(missing).toBe("missing_required");

    const completed = await correctAndReevaluate(deps(), {
      organizationId: p.organizationId,
      invoiceId: id,
      actor: CORRECTOR,
      submitted: {
        payee_name: "Nube Andina SAS",
        invoice_number: "F-9999",
        currency: "cop",
        total: "4.800.000,00",
      },
    });
    expect(completed.decision.verdict).not.toBe("pagar");
    expect(completed.decision.amount).toEqual({ amount: 480_000_000, currency: "COP" });
    expect(completed.decision.field_sources).toMatchObject({
      payee_name: "humano",
      currency: "humano",
    });
  });
});

describe("reevaluar con la política vigente", () => {
  it("una escalada por umbral se paga sola si una política nueva sube el umbral", async () => {
    p = await openPipeline();
    const id = await process("sobre_umbral");
    const current = p.policyVersion.content;
    await repos.appendPolicyVersion(
      p.t.db,
      p.organizationId,
      {
        content: PolicySchema.parse({
          ...current,
          limits: { ...current.limits, approval_threshold: current.limits.per_payment },
        }),
        signedBy: CORRECTOR,
        signedAt: p.t.now().toISOString(),
      },
      p.t.newId,
    );
    const result = await reevaluateWithCurrentPolicy(deps(), {
      organizationId: p.organizationId,
      invoiceId: id,
      actor: CORRECTOR,
    });
    expect(result.decision.verdict).toBe("pagar");
    expect(result.decision.actor).toEqual({ kind: "agente" });
    const v2 = await repos.getCurrentPolicy(p.t.db, p.organizationId);
    expect(result.decision.policy_version_id).toBe(v2?.id);
  });

  it("nunca ablanda: la instrucción que venía en el cuerpo del correo sigue frenando aunque no se guardó", async () => {
    p = await openPipeline();
    const id = await process("adv_aprobado_cfo");
    const before = await repos.getLatestDecision(p.t.db, p.organizationId, id);
    expect(before && decidingFinding(before)?.code).toBe("suspicious_instructions");
    const result = await reevaluateWithCurrentPolicy(deps(), {
      organizationId: p.organizationId,
      invoiceId: id,
      actor: CORRECTOR,
    });
    expect(result.decision.verdict).toBe("frenar");
    expect(decidingFinding(result.decision)?.code).toBe("suspicious_instructions");
  });

  it("una factura ya pagada no se reevalúa: comprometería dos veces", async () => {
    p = await openPipeline();
    const id = await process("camila_oct");
    expect(
      await reevaluateWithCurrentPolicy(deps(), {
        organizationId: p.organizationId,
        invoiceId: id,
        actor: CORRECTOR,
      }).catch(codeOf),
    ).toBe("not_correctable");
  });
});
