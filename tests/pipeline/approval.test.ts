import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { PolicySchema, type ApprovalPayload } from "@/src/domain";
import { signApproval } from "@/src/session";
import {
  ApprovalError,
  approvalOffer,
  approveEscalation,
  changeControls,
  loadInbox,
  processInvoice,
  rejectEscalation,
  type ResolutionDeps,
} from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-44, P-45 y P-103: la aprobación humana se verifica en el servidor. Solo una persona de la
 * lista convierte una escalada en pago, firmando el contenido exacto; la primera resolución
 * gana; nada se paga si el contenido cambió, si el mismo cobro ya se pagó o si no alcanza.
 */

const SECRET = "secreto-de-firma-de-prueba-0000000000000000";
const APPROVER = "Diego Leal";

let p: Pipeline;
afterEach(async () => {
  await p.close();
});

function resolution(): ResolutionDeps {
  return {
    db: p.t.db,
    newId: p.t.newId,
    now: p.t.now,
    timeZone: "America/Bogota",
    businessDate: "2026-10-17",
    signingSecret: SECRET,
  };
}

async function process(id: string, receipt = `batch:${id}`): Promise<string> {
  const f = await datasetCase(id);
  p.client.next = f.modelOutput;
  const result = await processInvoice(p.deps, p.input(f.bytes, receipt, f.fileName));
  return result.invoice.id;
}

async function offerFor(invoiceId: string) {
  const offer = await approvalOffer(resolution(), p.organizationId, invoiceId);
  if (!offer) throw new Error("sin oferta de aprobación");
  return offer;
}

async function approve(
  invoiceId: string,
  overrides: { approver?: string | null; codes?: string[] } = {},
) {
  const offer = await offerFor(invoiceId);
  return approveEscalation(resolution(), {
    organizationId: p.organizationId,
    invoiceId,
    payload: offer.payload,
    signature: offer.signature,
    approver: overrides.approver === undefined ? APPROVER : overrides.approver,
    checkedCodes: overrides.codes ?? offer.checklist.map((c) => c.code),
  });
}

const codeOf = (error: unknown) => (error instanceof ApprovalError ? error.code : String(error));

describe("aprobar una escalada (P-103)", () => {
  it("una persona de la lista aprueba con el checklist completo: pago con su nombre, presupuesto y saldo una vez", async () => {
    p = await openPipeline();
    const id = await process("sobre_umbral");
    const offer = await offerFor(id);
    expect(offer.blocked).toBeNull();
    expect(offer.checklist.map((c) => c.code)).toEqual([
      "amount_over_approval_threshold",
      "general",
    ]);
    const ledgerBefore = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    const copBefore = (await repos.listBalances(p.t.db, p.organizationId)).find(
      (b) => b.currency === "COP",
    );

    const result = await approve(id);

    expect(result.invoice.status).toBe("aprobada");
    expect(result.decision.verdict).toBe("pagar");
    expect(result.decision.actor).toEqual({ kind: "humano", name: APPROVER });
    expect(result.decision.previous_decision_id).toBe(offer.payload.decision_id);
    expect(result.decision.payment_order?.account_masked).toBe(offer.payload.account_masked);
    expect(result.approval.consumed_at).not.toBeNull();
    const ledgerAfter = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    expect((ledgerAfter?.committed ?? 0) - (ledgerBefore?.committed ?? 0)).toBe(
      result.decision.amount_usd?.amount,
    );
    const copAfter = (await repos.listBalances(p.t.db, p.organizationId)).find(
      (b) => b.currency === "COP",
    );
    expect((copBefore?.available ?? 0) - (copAfter?.available ?? 0)).toBe(
      result.decision.amount?.amount,
    );

    const events = await repos.listEvents(p.t.db, p.organizationId, { invoiceId: id });
    expect(events[0]?.type).toBe("invoice.approved");
    expect(events[0]?.actor).toEqual({ kind: "humano", name: APPROVER });
    const inbox = await loadInbox(p.t.db, p.organizationId, {
      decidedSince: "2026-10-17T05:00:00.000Z",
      now: p.t.now(),
    });
    expect(inbox.waiting.some((r) => r.invoiceId === id)).toBe(false);
  });

  it("P-44 dos aprobaciones a la vez: exactamente una gana y el presupuesto se compromete una vez", async () => {
    p = await openPipeline();
    const id = await process("sobre_umbral");
    const before = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    const outcomes = await Promise.all(
      [approve(id), approve(id), approve(id)].map((a) => a.then(() => "ok", codeOf)),
    );
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "already_resolved")).toHaveLength(2);
    const after = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    const decisions = await repos.listDecisions(p.t.db, p.organizationId, id);
    expect(decisions.filter((d) => d.verdict === "pagar")).toHaveLength(1);
    expect((after?.committed ?? 0) - (before?.committed ?? 0)).toBe(
      decisions[0]?.amount_usd?.amount,
    );
  });
});

describe("lo que el servidor rechaza (P-45)", () => {
  it("un contenido alterado no tiene firma válida, aunque llegue bien formado", async () => {
    p = await openPipeline();
    const id = await process("sobre_umbral");
    const offer = await offerFor(id);
    const tampered: ApprovalPayload = { ...offer.payload, amount: { amount: 1, currency: "COP" } };
    const error = await approveEscalation(resolution(), {
      organizationId: p.organizationId,
      invoiceId: id,
      payload: tampered,
      signature: offer.signature,
      approver: APPROVER,
      checkedCodes: offer.checklist.map((c) => c.code),
    }).catch(codeOf);
    expect(error).toBe("invalid_signature");
    // Firmarlo con otro secreto tampoco sirve.
    const forged = await approveEscalation(resolution(), {
      organizationId: p.organizationId,
      invoiceId: id,
      payload: tampered,
      signature: signApproval(tampered, "otro-secreto-cualquiera-0000000000000000"),
      approver: APPROVER,
      checkedCodes: offer.checklist.map((c) => c.code),
    }).catch(codeOf);
    expect(forged).toBe("invalid_signature");
  });

  it("si la cuenta registrada cambió después de revisar, la firma vieja ya no vale", async () => {
    p = await openPipeline();
    const id = await process("sobre_umbral");
    const offer = await offerFor(id);
    const vendorId = offer.payload.vendor_id ?? "";
    const vendor = await repos.getVendor(p.t.db, p.organizationId, vendorId);
    await p.t.db.run(
      sql`UPDATE vendors SET account = ${JSON.stringify({ ...vendor.account, account_number: "99990000111" })} WHERE id = ${vendorId}`,
    );
    const error = await approveEscalation(resolution(), {
      organizationId: p.organizationId,
      invoiceId: id,
      payload: offer.payload,
      signature: offer.signature,
      approver: APPROVER,
      checkedCodes: offer.checklist.map((c) => c.code),
    }).catch(codeOf);
    expect(error).toBe("stale_content");
    expect((await repos.getInvoice(p.t.db, p.organizationId, id)).status).toBe(
      "esperando_aprobacion",
    );
  });

  it("si la política cambió, no se aprueba: hay que reevaluar", async () => {
    p = await openPipeline();
    const id = await process("sobre_umbral");
    const current = p.policyVersion.content;
    await repos.appendPolicyVersion(
      p.t.db,
      p.organizationId,
      {
        content: PolicySchema.parse({
          ...current,
          controls: { ...current.controls, autonomy: "recomendar" },
        }),
        signedBy: APPROVER,
        signedAt: p.t.now().toISOString(),
      },
      p.t.newId,
    );
    expect((await offerFor(id)).blocked).toMatch(/política cambió/);
    expect(await approve(id).catch(codeOf)).toBe("not_approvable");
  });

  it("con los pagos apagados nadie aprueba un pago, solo se rechaza (invariante 9)", async () => {
    p = await openPipeline();
    await changeControls(resolution(), {
      organizationId: p.organizationId,
      controls: { payments_enabled: false },
      signedBy: APPROVER,
    });
    const id = await process("sobre_umbral");
    const offer = await offerFor(id);
    expect(offer.blocked).toMatch(/pagos están apagados/);
    expect(offer.needsReevaluation).toBe(false);
    expect(await approve(id).catch(codeOf)).toBe("not_approvable");
    const decisions = await repos.listDecisions(p.t.db, p.organizationId, id);
    expect(decisions.some((d) => d.verdict === "pagar")).toBe(false);
    const rejected = await rejectEscalation(resolution(), {
      organizationId: p.organizationId,
      invoiceId: id,
      payload: offer.payload,
      signature: offer.signature,
      approver: APPROVER,
      reason: "Pagos detenidos por emergencia",
    });
    expect(rejected.invoice.status).toBe("rechazada");
  });

  it("checklist incompleto, aprobador ajeno a la lista o sin aprobador: no se aprueba", async () => {
    p = await openPipeline();
    const id = await process("sobre_umbral");
    expect(await approve(id, { codes: ["general"] }).catch(codeOf)).toBe("checklist_incomplete");
    expect(await approve(id, { approver: "Alguien Más" }).catch(codeOf)).toBe("not_authorized");
    expect(await approve(id, { approver: null }).catch(codeOf)).toBe("not_authorized");
    expect(
      await repos.findApprovalByDecision(
        p.t.db,
        p.organizationId,
        (await offerFor(id)).payload.decision_id,
      ),
    ).toBeNull();
  });

  it("un beneficiario desconocido no se puede aprobar, solo rechazar con motivo; el rechazo es final", async () => {
    p = await openPipeline();
    const id = await process("beneficiario_nuevo");
    const offer = await offerFor(id);
    expect(offer.blocked).toMatch(/no está en la lista de beneficiarios aprobados/);
    expect(offer.payload.vendor_id).toBeNull();
    expect(await approve(id).catch(codeOf)).toBe("not_approvable");

    const reject = (reason: string) =>
      rejectEscalation(resolution(), {
        organizationId: p.organizationId,
        invoiceId: id,
        payload: offer.payload,
        signature: offer.signature,
        approver: APPROVER,
        reason,
      });
    expect(await reject("no").catch(codeOf)).toBe("reason_required");
    const rejected = await reject("Proveedor desconocido, no hay contrato");
    expect(rejected.invoice.status).toBe("rechazada");
    expect(rejected.approval.reason).toBe("Proveedor desconocido, no hay contrato");
    expect(await reject("otra vez").catch(codeOf)).toBe("already_resolved");
    expect(await approvalOffer(resolution(), p.organizationId, id)).toBeNull();
    const decisions = await repos.listDecisions(p.t.db, p.organizationId, id);
    expect(decisions.some((d) => d.verdict === "pagar")).toBe(false);
  });

  it("si el mismo cobro ya se pagó en otra factura, la aprobación no paga dos veces", async () => {
    p = await openPipeline();
    const escalated = await process("sobre_umbral");
    // Otra factura, ya pagada, con la misma llave del cobro: el caso que la guarda cubre.
    const paid = await process("nube_oct");
    await p.t.db.run(sql`UPDATE invoices SET status = 'aprobada' WHERE id = ${paid}`);
    const key = (await repos.getInvoice(p.t.db, p.organizationId, escalated)).semantic_key;
    await p.t.db.run(sql`UPDATE invoices SET semantic_key = ${key} WHERE id = ${paid}`);

    expect(await approve(escalated).catch(codeOf)).toBe("duplicate_paid");
    expect((await repos.getInvoice(p.t.db, p.organizationId, escalated)).status).toBe(
      "esperando_aprobacion",
    );
  });

  it("si el presupuesto ya no alcanza, nada se escribe", async () => {
    p = await openPipeline();
    const id = await process("sobre_umbral");
    const period = await repos.getLedgerPeriod(p.t.db, p.organizationId, "2026-10", "USD");
    if (!period) throw new Error("sin periodo");
    await repos.reserveBudget(
      p.t.db,
      p.organizationId,
      "2026-10",
      "USD",
      period.limit - period.committed,
      p.t.now().toISOString(),
    );
    expect(await approve(id).catch(codeOf)).toBe("budget_exceeded");
    expect((await repos.getInvoice(p.t.db, p.organizationId, id)).status).toBe(
      "esperando_aprobacion",
    );
    expect(
      await repos.findApprovalByDecision(
        p.t.db,
        p.organizationId,
        (await offerFor(id)).payload.decision_id,
      ),
    ).toBeNull();
  });
});
