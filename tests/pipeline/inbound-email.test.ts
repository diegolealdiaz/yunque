import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import {
  INBOUND_TOKEN,
  inboundAddressFor,
  newInboundToken,
  verifyWebhookAuth,
} from "@/src/session";
import {
  admitInboundEmail,
  inboundPayload,
  loadInboundAddress,
  processInvoice,
  requestInboundAddress,
  type InboundEmail,
} from "@/src/usecases";

import { generatedFile } from "../extraction/helpers";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-131 a P-134: correo real de entrada (D23). Solo quien tiene el código obtiene una
 * dirección; un correo a una dirección desconocida no toca nada; vencida o con el tope
 * alcanzado queda en la bitácora sin procesarse; el primer adjunto que de verdad es factura
 * se procesa por el canal Correo, y un reintento del proveedor no la duplica.
 */

const BASE = "abc123@inbound.postmarkapp.com";
const CODE = "codigo-de-jurado-2026";
const LIMITS = { maxPerAddressPerDay: 2, maxPerDay: 3 };
const SINCE = "2026-10-17T05:00:00.000Z";

let p: Pipeline;
let pdf: Uint8Array;

beforeAll(async () => {
  p = await openPipeline();
  pdf = await generatedFile("camila_email.pdf");
}, 60_000);

afterAll(async () => {
  await p.close();
});

const at = (iso: string) => new Date(iso);

function email(token: string, messageId: string, attachments: InboundEmail["Attachments"] = []) {
  return {
    MessageID: messageId,
    MailboxHash: token,
    From: "jurado@ejemplo.co",
    Subject: "Factura de prueba",
    TextBody: "Adjunto la factura.",
    Date: "Sat, 17 Oct 2026 10:00:00 -0500",
    Attachments: attachments,
  } satisfies InboundEmail;
}

const pdfAttachment = () => ({ Name: "factura.pdf", Content: Buffer.from(pdf).toString("base64") });

async function newAddress(now: Date, ttlHours = 72) {
  const view = await requestInboundAddress(p.t.db, {
    organizationId: p.organizationId,
    code: CODE,
    expectedCode: CODE,
    base: BASE,
    ttlHours,
    now,
    newToken: newInboundToken,
  });
  const token = view.address.slice(view.address.indexOf("+") + 1, view.address.indexOf("@"));
  return { view, token };
}

describe("direcciones de correo (P-131)", () => {
  it("un código equivocado no crea nada; el correcto da una dirección que no se adivina", async () => {
    const now = at("2026-10-17T12:00:00.000Z");
    await expect(
      requestInboundAddress(p.t.db, {
        organizationId: p.organizationId,
        code: "otro-codigo-cualquiera",
        expectedCode: CODE,
        base: BASE,
        ttlHours: 72,
        now,
        newToken: newInboundToken,
      }),
    ).rejects.toMatchObject({ code: "not_authorized" });
    expect(await loadInboundAddress(p.t.db, p.organizationId, BASE, now)).toBeNull();

    const { view, token } = await newAddress(now);
    expect(token).toMatch(INBOUND_TOKEN);
    expect(view.address).toBe(inboundAddressFor(BASE, token));
    expect(view.expiresAt).toBe("2026-10-20T12:00:00.000Z");
    // Pedirla otra vez devuelve la misma mientras siga vigente.
    expect((await newAddress(at("2026-10-18T12:00:00.000Z"))).view).toEqual(view);
    expect(new Set(Array.from({ length: 50 }, newInboundToken)).size).toBe(50);
  });

  it("el webhook solo vale con la contraseña exacta", () => {
    const header = (user: string, pass: string) =>
      `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    const secret = "s".repeat(40);
    expect(verifyWebhookAuth(header("yunque", secret), secret)).toBe(true);
    expect(verifyWebhookAuth(header("yunque", `${secret}x`), secret)).toBe(false);
    expect(verifyWebhookAuth(header("yunque", ""), secret)).toBe(false);
    expect(verifyWebhookAuth(null, secret)).toBe(false);
    expect(verifyWebhookAuth(`Bearer ${secret}`, secret)).toBe(false);
  });
});

describe("admisión de un correo (P-132, P-133)", () => {
  it("un token desconocido o mal formado se ignora sin registrar nada", async () => {
    const now = at("2026-10-17T12:00:00.000Z");
    const before = await repos.listEvents(p.t.db, p.organizationId, { limit: 500 });
    for (const token of ["", "noexiste2345", "../../etc", "ABCDEFGHIJKL"]) {
      const admission = await admitInboundEmail(p.t.db, {
        email: email(token, "id-desconocido"),
        limits: LIMITS,
        now,
        since: SINCE,
        newId: p.t.newId,
      });
      expect(admission.kind).toBe("ignored");
    }
    const after = await repos.listEvents(p.t.db, p.organizationId, { limit: 500 });
    expect(after.length).toBe(before.length);
  });

  it("una dirección vencida no procesa y deja constancia sin datos del remitente", async () => {
    const token = newInboundToken();
    await repos.insertInboundAddress(p.t.db, {
      token,
      organizationId: p.organizationId,
      createdAt: "2026-10-01T12:00:00.000Z",
      expiresAt: "2026-10-01T13:00:00.000Z",
    });
    const admission = await admitInboundEmail(p.t.db, {
      email: email(token, "id-vencida"),
      limits: LIMITS,
      now: at("2026-10-17T12:00:00.000Z"),
      since: SINCE,
      newId: p.t.newId,
    });
    expect(admission).toMatchObject({ kind: "rejected", reason: "expired" });
    const events = await repos.listEvents(p.t.db, p.organizationId, { limit: 500 });
    const rejected = events.find((e) => e.type === "email.rejected");
    expect(rejected?.data).toEqual({ reason: "expired", message_id: "id-vencida" });
    expect(JSON.stringify(rejected)).not.toContain("jurado@ejemplo.co");
  });
});

describe("procesar un correo real (P-134)", () => {
  it("el primer adjunto que es factura entra por Correo; el reintento no la duplica; el tope corta", async () => {
    const now = at("2026-10-17T12:00:00.000Z");
    const { token } = await newAddress(now);
    const caseFixture = await datasetCase("camila_email");

    const deliver = async (messageId: string) => {
      const message = email(token, messageId, [
        { Name: "notas.txt", Content: Buffer.from("no soy factura").toString("base64") },
        pdfAttachment(),
      ]);
      const admission = await admitInboundEmail(p.t.db, {
        email: message,
        limits: LIMITS,
        now,
        since: SINCE,
        newId: p.t.newId,
      });
      if (admission.kind !== "accepted") return admission;
      p.client.next = caseFixture.modelOutput;
      const { bytes, originalName } = inboundPayload(message, { now, maxBytes: 5 * 1024 * 1024 });
      expect(originalName).toBe("factura.pdf");
      return processInvoice(p.deps, {
        organizationId: admission.organizationId,
        channel: "inbox",
        receiptKey: admission.receiptKey,
        bytes,
        originalName,
      });
    };

    const first = await deliver("pm-uno");
    expect(first).toMatchObject({ kind: "decided" });
    if (!("invoice" in first)) throw new Error("sin factura");
    expect(first.invoice.channel).toBe("inbox");
    expect(first.invoice.receipt_key).toBe("inbox:pm-pm-uno");

    // El proveedor reintenta el mismo correo: pasa la admisión pero no se procesa otra vez.
    expect(await deliver("pm-uno")).toMatchObject({ kind: "already_received" });

    expect(await deliver("pm-dos")).toMatchObject({ kind: "decided" });
    // Tope por dirección: 2 por día.
    expect(await deliver("pm-tres")).toMatchObject({ kind: "rejected", reason: "address_limit" });
    expect(await repos.countInboundEmailsSince(p.t.db, p.organizationId, SINCE)).toBe(2);
  });

  it("sin adjunto válido el correo entra igual, como mensaje sin factura", () => {
    const now = at("2026-10-17T12:00:00.000Z");
    const huge = { Name: "grande.pdf", Content: "A".repeat(2_000) };
    const { bytes, originalName } = inboundPayload(email("x", "m", [huge]), {
      now,
      maxBytes: 1_000,
    });
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    expect(payload).toMatchObject({
      kind: "email",
      attachment: null,
      subject: "Factura de prueba",
      sent_at: "2026-10-17T15:00:00.000Z",
    });
    expect(originalName).toBe("correo.json");
  });
});
