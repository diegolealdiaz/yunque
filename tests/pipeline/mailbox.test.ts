import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { datasetReceiptKey, mailboxReceiptKey } from "@/src/dataset/demo-seed";
import { loadMailbox, type MailboxMessage } from "@/src/dataset/mailbox";
import * as repos from "@/src/db/repositories";
import { decidingFinding } from "@/src/engine";
import { processInvoice } from "@/src/usecases";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-88: la bandeja simulada recibe cada correo una sola vez, aunque se lea dos veces o el
 * mismo correo llegue también por "Procesar periodo"; un correo sin factura adjunta se
 * escala como ilegible sin llamar al modelo.
 */

let p: Pipeline;
let mailbox: MailboxMessage[];

beforeAll(async () => {
  p = await openPipeline();
  mailbox = await loadMailbox();
}, 60_000);

afterAll(async () => {
  await p.close();
});

async function readMessage(message: MailboxMessage) {
  if (message.hasAttachment) p.client.next = (await datasetCase(message.id)).modelOutput;
  return processInvoice(p.deps, {
    organizationId: p.organizationId,
    channel: "inbox",
    receiptKey: mailboxReceiptKey(message.id),
    bytes: new Uint8Array(await readFile(message.file)),
    originalName: message.file.split("/").pop() ?? message.id,
  });
}

describe("bandeja simulada (P-88)", () => {
  it("trae los correos del dataset y el mensaje sin factura, el más viejo primero", () => {
    expect(mailbox.map((m) => m.id)).toEqual([
      "camila_email",
      "stackline_email",
      "lucia_email",
      "adv_aprobado_cfo",
      "sin_factura",
    ]);
    expect(mailbox.find((m) => m.id === "sin_factura")?.hasAttachment).toBe(false);
    expect(new Set(mailbox.map((m) => m.messageId)).size).toBe(mailbox.length);
  });

  it("leer la bandeja dos veces recibe cada correo una sola vez", async () => {
    const before = (await repos.listInvoices(p.t.db, p.organizationId, { limit: 500 })).length;
    const first = [];
    for (const message of mailbox) first.push(await readMessage(message));
    expect(first.every((r) => r.kind === "decided")).toBe(true);
    const second = [];
    for (const message of mailbox) second.push(await readMessage(message));
    expect(second.every((r) => r.kind === "already_received")).toBe(true);
    expect(second.map((r) => r.invoice.id)).toEqual(first.map((r) => r.invoice.id));
    const after = (await repos.listInvoices(p.t.db, p.organizationId, { limit: 500 })).length;
    expect(after - before).toBe(mailbox.length);
  }, 120_000);

  it("un correo ya leído de la bandeja no se recibe de nuevo al procesar el periodo", async () => {
    const f = await datasetCase("camila_email");
    expect(datasetReceiptKey(f.case)).toBe(mailboxReceiptKey("camila_email"));
    const again = await processInvoice(p.deps, {
      ...p.input(f.bytes, datasetReceiptKey(f.case), f.fileName),
      channel: "inbox",
    });
    expect(again.kind).toBe("already_received");
  });

  it("el correo sin factura se escala como ilegible y no llama al modelo", async () => {
    const invoice = await repos.findInvoiceByReceiptKey(
      p.t.db,
      p.organizationId,
      mailboxReceiptKey("sin_factura"),
    );
    if (!invoice) throw new Error("el correo sin factura debería estar recibido");
    const decision = await repos.getLatestDecision(p.t.db, p.organizationId, invoice.id);
    expect(decision?.verdict).toBe("escalar");
    expect(decision && decidingFinding(decision)?.code).toBe("extraction_unreadable");
    expect(invoice.page_keys).toEqual([]);
    expect(invoice.text).toContain("quería confirmar");
    expect(await repos.listLlmCalls(p.t.db, p.organizationId, invoice.id)).toHaveLength(0);
    const extraction = await repos.getLatestExtraction(p.t.db, p.organizationId, invoice.id);
    expect(extraction?.record.extraction).toEqual({
      kind: "unreadable",
      reason: "El mensaje no trae una factura adjunta",
    });
  });
});
