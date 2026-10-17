import { openPdf } from "clawpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import {
  paymentOrderHash,
  paymentOrderQr,
  renderPaymentOrder,
} from "@/src/documents/payment-order";
import { formatMoney } from "@/src/domain";
import { loadPaymentOrder, processInvoice } from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-111: la orden de pago en PDF sale de lo que la decisión registró (el vendor dado de
 * alta), no del texto leído; es determinista y solo existe para facturas pagadas con orden.
 */

const TZ = "America/Bogota";

let p: Pipeline;
const ids = new Map<string, string>();

beforeAll(async () => {
  p = await openPipeline();
  for (const id of ["nube_oct", "sobre_umbral"]) {
    const f = await datasetCase(id);
    p.client.next = f.modelOutput;
    const result = await processInvoice(p.deps, {
      ...p.input(f.bytes, `batch:${id}`, f.fileName),
      channel: "batch",
    });
    ids.set(id, result.invoice.id);
  }
}, 120_000);

afterAll(async () => {
  await p.close();
});

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await openPdf(bytes);
  try {
    return pdf.text();
  } finally {
    pdf.destroy();
  }
}

describe("orden de pago en PDF (P-111)", () => {
  it("lleva los datos del vendor registrado, el monto, la política y la huella", async () => {
    const invoiceId = ids.get("nube_oct") ?? "";
    const sheet = await loadPaymentOrder(p.t.db, p.organizationId, invoiceId, TZ);
    if (!sheet) throw new Error("la factura pagada debería tener orden");
    const decision = await repos.getLatestDecision(p.t.db, p.organizationId, invoiceId);
    const vendors = await repos.listVendors(p.t.db, p.organizationId);
    const vendor = vendors.find((v) => v.id === decision?.vendor_id);
    expect(vendor).toBeDefined();
    expect(sheet.order.beneficiary_name).toBe(vendor?.name);
    expect(sheet.order.account_masked.slice(-4)).toBe(vendor?.account.account_number.slice(-4));

    const bytes = await renderPaymentOrder(sheet);
    const text = await pdfText(bytes);
    expect(text).toContain(sheet.order.beneficiary_name);
    expect(text).toContain(formatMoney(sheet.order.amount));
    expect(text).toContain(sheet.order.reference);
    expect(text).toContain(sheet.policyHash);
    expect(text).toContain(paymentOrderHash(sheet));
    expect(paymentOrderQr(sheet)).toBe(
      `yunque:orden:v1:${sheet.decisionId}:${paymentOrderHash(sheet)}`,
    );
  });

  it("es determinista y la huella cambia si cambia cualquier dato de la orden", async () => {
    const sheet = await loadPaymentOrder(p.t.db, p.organizationId, ids.get("nube_oct") ?? "", TZ);
    if (!sheet) throw new Error("sin orden");
    expect(await renderPaymentOrder(sheet)).toEqual(await renderPaymentOrder(sheet));
    const altered = {
      ...sheet,
      order: {
        ...sheet.order,
        amount: { ...sheet.order.amount, amount: sheet.order.amount.amount + 1 },
      },
    };
    expect(paymentOrderHash(altered)).not.toBe(paymentOrderHash(sheet));
  });

  it("no hay orden para una escalada ni para la factura de otra empresa", async () => {
    expect(
      await loadPaymentOrder(p.t.db, p.organizationId, ids.get("sobre_umbral") ?? "", TZ),
    ).toBeNull();
    const other = p.t.newId();
    const org = await repos.getOrganization(p.t.db, p.organizationId);
    await repos.createOrganization(p.t.db, { ...org, id: other, demo_visitor_id: "otra-orden" });
    expect(await loadPaymentOrder(p.t.db, other, ids.get("nube_oct") ?? "", TZ)).toBeNull();
  });
});
