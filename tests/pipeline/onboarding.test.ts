import { afterEach, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { decidingFinding } from "@/src/engine";
import {
  ApprovalError,
  UseCaseError,
  approvalOffer,
  approveEscalation,
  changeControls,
  onboardVendor,
  processInvoice,
  vendorDraftFor,
  type DecideDeps,
} from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-157: alta de un beneficiario desde la factura que lo trae. Con la doble firma, queda sin
 * verificar y otra persona lo verifica al aprobar; sin ella, basta una persona. Nunca se da de
 * alta un duplicado ni un nombre parecido sin confirmarlo.
 */

const SECRET = "secreto-de-firma-de-prueba-0000000000000000";
const DIEGO = "Diego Leal";
const ANA = "Ana Torres";

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
  return (await processInvoice(p.deps, p.input(f.bytes, `upload:${id}`, f.fileName))).invoice.id;
}

const codeOf = (error: unknown) =>
  error instanceof UseCaseError || error instanceof ApprovalError ? error.code : String(error);

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

async function onboard(
  invoiceId: string,
  actor: string,
  overrides: Partial<Parameters<typeof onboardVendor>[1]> = {},
) {
  const draft = await vendorDraftFor(deps(), p.organizationId, invoiceId);
  if (!draft) throw new Error("la factura no admite el alta");
  return onboardVendor(deps(), {
    organizationId: p.organizationId,
    invoiceId,
    actor,
    name: draft.name,
    taxId: draft.taxId,
    rail: draft.rails[0] ?? "",
    accountNumber: draft.accountNumber,
    holderName: draft.holderName,
    confirmedOutOfBand: true,
    notTheLookalike: false,
    ...overrides,
  });
}

describe("alta de beneficiario desde la factura (P-157)", () => {
  it("con doble firma: queda sin verificar y lo verifica otra persona al aprobar", async () => {
    p = await openPipeline();
    await changeControls(deps(), {
      organizationId: p.organizationId,
      controls: { four_eyes: true },
      signedBy: DIEGO,
    });
    const id = await process("beneficiario_nuevo");
    const draft = await vendorDraftFor(deps(), p.organizationId, id);
    expect(draft).toMatchObject({
      name: "Soluciones Cloud SAS",
      taxId: "901999888-1",
      currency: "COP",
      accountNumber: "77001122334",
      lookalike: null,
      fourEyes: true,
    });

    const { vendor, decision } = await onboard(id, DIEGO);
    expect(vendor.verification.status).toBe("pendiente");
    const policy = await repos.getCurrentPolicy(p.t.db, p.organizationId);
    expect(policy?.content.allowed_payees).toContain(vendor.id);
    expect(decision.verdict).toBe("escalar");
    expect(decision.findings.map((f) => f.code)).toContain("vendor_not_verified");
    // Ya no se ofrece otra alta para la misma factura.
    expect(await vendorDraftFor(deps(), p.organizationId, id)).toBeNull();

    expect(await approveAs(id, DIEGO).catch(codeOf)).toBe("self_approval");
    const approved = await approveAs(id, ANA);
    expect(approved.decision.verdict).toBe("pagar");
    const verified = await repos.getVendor(p.t.db, p.organizationId, vendor.id);
    expect(verified.verification).toMatchObject({ status: "verificado", by: ANA });
    const events = await repos.listEvents(p.t.db, p.organizationId, { limit: 100 });
    expect(
      events.some((e) => e.type === "vendor.created" && e.data["vendor_id"] === vendor.id),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "vendor.verified" && e.actor.kind === "humano" && e.actor.name === ANA,
      ),
    ).toBe(true);
  }, 120_000);

  it("sin doble firma: una sola persona da de alta y aprueba", async () => {
    p = await openPipeline();
    // La doble firma viene apagada por defecto.
    const policy = await repos.getCurrentPolicy(p.t.db, p.organizationId);
    expect(policy?.content.controls.four_eyes).toBe(false);

    const id = await process("beneficiario_nuevo");
    const { vendor, decision } = await onboard(id, DIEGO);
    expect(vendor.verification).toMatchObject({ status: "verificado", by: DIEGO });
    expect(decision.verdict).toBe("escalar");
    expect(decidingFinding(decision)?.code).toBe("first_payment_to_vendor");
    expect((await approveAs(id, DIEGO)).decision.verdict).toBe("pagar");
  }, 120_000);

  it("no da de alta un posible fraude ni un dato sin confirmar", async () => {
    p = await openPipeline();
    const lookalike = await process("parecido");
    const draft = await vendorDraftFor(deps(), p.organizationId, lookalike);
    expect(draft?.lookalike).toBe("Nube Andina SAS");
    // Pide pagar a la cuenta registrada de Nube Andina SAS con otro nombre: no se crea.
    expect(await onboard(lookalike, DIEGO, { notTheLookalike: true }).catch(codeOf)).toBe(
      "vendor_exists",
    );
    // Con otra cuenta, el nombre parecido exige confirmar que es otra empresa.
    expect(await onboard(lookalike, DIEGO, { accountNumber: "55500011122" }).catch(codeOf)).toBe(
      "invalid_vendor",
    );

    const id = await process("beneficiario_nuevo");
    expect(await onboard(id, DIEGO, { confirmedOutOfBand: false }).catch(codeOf)).toBe(
      "invalid_vendor",
    );
    expect(await onboard(id, "Alguien Más").catch(codeOf)).toBe("not_authorized");
    expect(await onboard(id, DIEGO, { rail: "pix" }).catch(codeOf)).toBe("invalid_vendor");
    const vendors = await repos.listVendors(p.t.db, p.organizationId);
    expect(vendors.some((v) => v.name === "Soluciones Cloud SAS")).toBe(false);
  }, 120_000);
});
