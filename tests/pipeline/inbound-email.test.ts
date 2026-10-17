import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as repos from "@/src/db/repositories";
import { InboundTokenSchema } from "@/src/domain";
import { inboundAddressFor, newInboundToken, verifyWebhookAuth } from "@/src/session";
import {
  MAX_REJECTED_PER_DAY,
  admitInboundEmail,
  inboundPayload,
  loadInboundAddress,
  processInboundEmail,
  ensureInboundAddress,
  grantDemoAccess,
  type InboundEmail,
} from "@/src/usecases";

import { generatedFile } from "../extraction/helpers";

import { datasetCase, openPipeline, type Pipeline } from "./helpers";

/**
 * P-131 a P-134: correo real de entrada (D23). Solo quien tiene el código obtiene una
 * dirección; un correo a una dirección desconocida no toca nada; vencida o con el tope
 * alcanzado deja su recibo sin procesarse, y la bitácora no se llena; los topes aguantan una
 * ráfaga; el primer adjunto que de verdad es factura se procesa por el canal Correo, y un
 * reintento del proveedor no la duplica.
 */

const BASE = "abc123@inbound.postmarkapp.com";
const CODE = "codigo-de-cliente-2026";
const LIMITS = { maxPerAddressPerDay: 2, maxPerDay: 3 };
const SINCE = "2026-10-17T05:00:00.000Z";
const NOW = new Date("2026-10-17T12:00:00.000Z");
const INVOICE_LIMITS = { perOrganization: 500, global: 5000 };

let p: Pipeline;
let pdf: Uint8Array;
let messages = 0;

beforeAll(async () => {
  p = await openPipeline();
  pdf = await generatedFile("camila_email.pdf");
}, 60_000);

afterAll(async () => {
  await p.close();
});

/** Una dirección nueva de la empresa de prueba, insertada directo con su vencimiento. */
async function address(expiresAt = "2026-10-20T12:00:00.000Z"): Promise<string> {
  const token = newInboundToken();
  await repos.insertInboundAddress(p.t.db, {
    token,
    organizationId: p.organizationId,
    createdAt: "2026-10-17T00:00:00.000Z",
    expiresAt,
  });
  return token;
}

function email(
  token: string,
  attachments: InboundEmail["Attachments"] = [],
  messageId = `mensaje-${String(++messages)}`,
): InboundEmail {
  return {
    MessageID: messageId,
    MailboxHash: token,
    From: "cliente@ejemplo.co",
    Subject: "Factura de prueba",
    TextBody: "Adjunto la factura.",
    Date: "Sat, 17 Oct 2026 10:00:00 -0500",
    Attachments: attachments,
  };
}

const admit = (message: InboundEmail, limits = LIMITS) =>
  admitInboundEmail(p.t.db, { email: message, limits, now: NOW, since: SINCE, newId: p.t.newId });

const rejectionEvents = async () =>
  (await repos.listEvents(p.t.db, p.organizationId, { limit: 1000 })).filter(
    (e) => e.type === "email.rejected",
  );

describe("direcciones de correo (P-131)", () => {
  it("un código equivocado no da acceso; con acceso, una dirección que no se adivina", async () => {
    const t = await openPipeline();
    try {
      const grant = (code: string) =>
        grantDemoAccess(t.t.db, {
          organizationId: t.organizationId,
          code,
          expectedCode: CODE,
          ttlHours: 72,
          now: NOW,
          newId: t.t.newId,
        });
      await expect(grant("otro-codigo-cualquiera")).rejects.toMatchObject({
        code: "not_authorized",
      });
      expect(await loadInboundAddress(t.t.db, t.organizationId, BASE, NOW)).toBeNull();

      const access = await grant(` ${CODE} `);
      expect(access.expiresAt).toBe("2026-10-20T12:00:00.000Z");
      // Escribir el código otra vez no extiende el acceso vigente.
      expect((await grant(CODE)).expiresAt).toBe(access.expiresAt);
      const request = () =>
        ensureInboundAddress(t.t.db, {
          organizationId: t.organizationId,
          base: BASE,
          until: access.expiresAt,
          now: NOW,
          newToken: newInboundToken,
        });
      const view = await request();
      const token = view.address.slice(view.address.indexOf("+") + 1, view.address.indexOf("@"));
      expect(InboundTokenSchema.safeParse(token).success).toBe(true);
      expect(view.address).toBe(inboundAddressFor(BASE, token));
      expect(view.expiresAt).toBe("2026-10-20T12:00:00.000Z");
      // Pedirla otra vez, incluso a la vez, devuelve la misma mientras siga vigente.
      const again = await Promise.all([1, 2, 3].map(() => request()));
      expect(again.every((v) => v.address === view.address)).toBe(true);
      expect(new Set(Array.from({ length: 50 }, newInboundToken)).size).toBe(50);
    } finally {
      await t.close();
    }
  });

  it("el webhook solo vale con la contraseña exacta", () => {
    const header = (scheme: string, user: string, pass: string) =>
      `${scheme} ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    const secret = "s".repeat(40);
    expect(verifyWebhookAuth(header("Basic", "yunque", secret), secret)).toBe(true);
    expect(verifyWebhookAuth(header("basic", "yunque", secret), secret)).toBe(true);
    expect(verifyWebhookAuth(header("Basic", "yunque", `${secret}x`), secret)).toBe(false);
    expect(verifyWebhookAuth(header("Basic", "yunque", ""), secret)).toBe(false);
    expect(verifyWebhookAuth(null, secret)).toBe(false);
    expect(verifyWebhookAuth(`Bearer ${secret}`, secret)).toBe(false);
  });
});

describe("admisión de un correo (P-132, P-133)", () => {
  it("un token desconocido o mal formado se ignora sin escribir nada", async () => {
    const before = (await repos.listEvents(p.t.db, p.organizationId, { limit: 1000 })).length;
    for (const token of ["", "noexiste2345", "../../etc", "abc"]) {
      expect(await admit(email(token))).toEqual({ kind: "ignored" });
    }
    expect((await repos.listEvents(p.t.db, p.organizationId, { limit: 1000 })).length).toBe(before);
  });

  it("el token se reconoce aunque el cliente de correo lo escriba en mayúsculas", async () => {
    const token = await address();
    expect(await admit(email(token.toUpperCase()))).toMatchObject({ kind: "accepted" });
  });

  it("una dirección vencida no procesa; la bitácora lo dice una vez y no se llena", async () => {
    const token = await address("2026-10-01T13:00:00.000Z");
    const first = email(token);
    expect(await admit(first)).toMatchObject({ kind: "rejected", reason: "expired" });
    // El reintento del proveedor obtiene la misma respuesta.
    expect(await admit(first)).toMatchObject({ kind: "rejected", reason: "expired" });
    expect(await admit(email(token))).toMatchObject({ kind: "rejected", reason: "expired" });

    const events = (await rejectionEvents()).filter((e) => e.data["reason"] === "expired");
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({ reason: "expired", message_id: first.MessageID });
    expect(JSON.stringify(events)).not.toContain("cliente@ejemplo.co");

    // Quien insiste con una dirección vencida deja de escribir en la base.
    for (let i = 0; i < MAX_REJECTED_PER_DAY; i++) await admit(email(token));
    expect(await repos.countRejectedSince(p.t.db, p.organizationId, SINCE)).toBe(
      MAX_REJECTED_PER_DAY,
    );
    expect(await admit(email(token))).toEqual({ kind: "ignored" });
  });
});

describe("topes y proceso de un correo real (P-134)", () => {
  it("una ráfaga no pasa del tope por dirección ni del tope de la demo", async () => {
    const t = await openPipeline();
    try {
      const make = async () => {
        const token = newInboundToken();
        await repos.insertInboundAddress(t.t.db, {
          token,
          organizationId: t.organizationId,
          createdAt: "2026-10-17T00:00:00.000Z",
          expiresAt: "2026-10-20T12:00:00.000Z",
        });
        return token;
      };
      const admitIn = (message: InboundEmail) =>
        admitInboundEmail(t.t.db, {
          email: message,
          limits: LIMITS,
          now: NOW,
          since: SINCE,
          newId: t.t.newId,
        });
      const first = await make();
      const burst = await Promise.all(Array.from({ length: 6 }, () => admitIn(email(first))));
      expect(burst.filter((a) => a.kind === "accepted")).toHaveLength(2);
      expect(
        burst.filter((a) => a.kind === "rejected" && a.reason === "address_limit"),
      ).toHaveLength(4);
      // Otra dirección: le queda un correo antes del tope de toda la demo (3).
      const second = await make();
      expect(await admitIn(email(second))).toMatchObject({ kind: "accepted" });
      expect(await admitIn(email(second))).toMatchObject({
        kind: "rejected",
        reason: "daily_limit",
      });
    } finally {
      await t.close();
    }
  });

  it("procesa el primer adjunto que es factura, por Correo, y un reintento no la duplica", async () => {
    const token = await address();
    const fixture = await datasetCase("camila_email");
    const message = email(
      token,
      [
        { Name: "notas.txt", Content: Buffer.from("no soy factura").toString("base64") },
        { Name: "falsa.pdf", Content: Buffer.from("MZ ejecutable").toString("base64") },
        { Name: "factura.pdf", Content: Buffer.from(pdf).toString("base64") },
      ],
      "uno",
    );
    const deliver = async () => {
      const admission = await admit(message);
      if (admission.kind !== "accepted") throw new Error(admission.kind);
      p.client.next = fixture.modelOutput;
      return processInboundEmail(p.deps, {
        email: message,
        organizationId: admission.organizationId,
        receiptKey: admission.receiptKey,
        invoiceLimits: INVOICE_LIMITS,
        since: SINCE,
        now: NOW,
      });
    };

    const first = await deliver();
    if (first.kind !== "processed") throw new Error("no se procesó");
    expect(first.result.kind).toBe("decided");
    expect(first.result.invoice.channel).toBe("inbox");
    expect(first.result.invoice.receipt_key).toBe("inbox:pm-uno");

    const retry = await deliver();
    expect(retry).toMatchObject({ kind: "processed", result: { kind: "already_received" } });
  });

  it("superado el tope de facturas, el correo admitido no se procesa y queda en la bitácora", async () => {
    const token = await address();
    const message = email(token, [{ Name: "f.pdf", Content: Buffer.from(pdf).toString("base64") }]);
    const admission = await admit(message);
    if (admission.kind !== "accepted") throw new Error(admission.kind);
    const outcome = await processInboundEmail(p.deps, {
      email: message,
      organizationId: admission.organizationId,
      receiptKey: admission.receiptKey,
      invoiceLimits: { perOrganization: 1, global: 1 },
      since: SINCE,
      now: NOW,
    });
    expect(outcome).toMatchObject({ kind: "not_processed", reason: "invoice_limit" });
    expect((await rejectionEvents()).some((e) => e.data["reason"] === "invoice_limit")).toBe(true);
    expect(
      await repos.findInvoiceByReceiptKey(p.t.db, p.organizationId, admission.receiptKey),
    ).toBe(null);
  });
});

describe("el correo como mensaje de canal (P-134)", () => {
  it("sin adjunto válido entra como mensaje sin factura; una fecha ilegible toma la de llegada", () => {
    const huge = { Name: "grande.pdf", Content: "A".repeat(2_000) };
    const { bytes, originalName } = inboundPayload(
      { ...email("x", [huge]), Date: "ayer por la tarde" },
      { now: NOW, maxBytes: 1_000 },
    );
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    expect(payload).toMatchObject({
      kind: "email",
      attachment: null,
      subject: "Factura de prueba",
      sent_at: NOW.toISOString(),
    });
    expect(originalName).toBe("correo.json");
  });

  it("una foto adjunta viaja con su tipo real, sin importar el nombre", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { bytes } = inboundPayload(
      email("x", [{ Name: null, Content: png.toString("base64") }]),
      { now: NOW, maxBytes: 1_000 },
    );
    expect(JSON.parse(new TextDecoder().decode(bytes))).toMatchObject({
      sent_at: "2026-10-17T15:00:00.000Z",
      attachment: { filename: "adjunto.png", content_type: "image/png" },
    });
  });
});
