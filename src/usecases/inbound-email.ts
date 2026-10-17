import { z } from "zod";

import type { Database } from "@/src/db/client";
import {
  appendEvent,
  countInboundEmailsSince,
  findActiveInboundAddress,
  findInboundAddress,
  findInvoiceByReceiptKey,
  insertInboundAddress,
  INBOUND_RECEIPT_PREFIX,
} from "@/src/db/repositories";
import { receiptKeyFor, type ReceiptKey, type Ulid } from "@/src/domain";
import { sniffType, type ChannelPayload } from "@/src/extraction";
import { INBOUND_TOKEN, inboundAddressFor, sameSecret } from "@/src/session";

import { UseCaseError } from "./errors";

/**
 * Correo real de entrada de la demo (D23). El proveedor recibe el correo y lo entrega al
 * webhook; aquí se decide si se procesa, sin gastar nada antes de saberlo:
 *
 *   correo ─► token (lo que va después del +) ─► dirección vigente ─► topes ─► processInvoice
 *               desconocido: se ignora           vencida: se registra    excedidos: se registra
 *
 * Capas de protección: solo quien tiene el código de acceso obtiene una dirección; la
 * dirección no se adivina y vence sola; topes por dirección y de toda la demo antes de
 * llamar al modelo; el tope de gasto del proveedor del modelo como techo final; y un
 * interruptor en la configuración. Yunque nunca responde un correo.
 */

/**
 * Lo que el proveedor de correo (Postmark) manda al webhook. Solo los campos que se usan;
 * el resto se ignora. Todo es contenido no confiable.
 */
export const InboundEmailSchema = z.object({
  MessageID: z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
  MailboxHash: z.string().max(200).nullish(),
  From: z.string().nullish(),
  Subject: z.string().nullish(),
  TextBody: z.string().nullish(),
  Date: z.string().nullish(),
  Attachments: z
    .array(z.object({ Name: z.string().nullish(), Content: z.string().nullish() }))
    .max(50)
    .nullish(),
});
export type InboundEmail = z.infer<typeof InboundEmailSchema>;

export type InboundLimits = {
  readonly maxPerAddressPerDay: number;
  readonly maxPerDay: number;
};

export type InboundAddressView = {
  readonly address: string;
  readonly expiresAt: string;
};

const HOUR_MS = 3_600_000;

/** Llave de recepción de un correo real: el id que le da el proveedor, estable en reintentos. */
export function inboundReceiptKey(messageId: string): ReceiptKey {
  return receiptKeyFor("inbox", `${INBOUND_RECEIPT_PREFIX.slice("inbox:".length)}${messageId}`);
}

/** La dirección vigente de la empresa, lista para mostrar; null si no tiene o ya venció. */
export async function loadInboundAddress(
  db: Database,
  organizationId: Ulid,
  base: string,
  now: Date,
): Promise<InboundAddressView | null> {
  const active = await findActiveInboundAddress(db, organizationId, now.toISOString());
  return active
    ? { address: inboundAddressFor(base, active.token), expiresAt: active.expiresAt }
    : null;
}

/**
 * Entrega una dirección a quien da el código de acceso: la vigente si ya tiene una, o una
 * nueva que vence en `ttlHours`. Un código equivocado no crea nada.
 */
export async function requestInboundAddress(
  db: Database,
  input: {
    readonly organizationId: Ulid;
    readonly code: string;
    readonly expectedCode: string;
    readonly base: string;
    readonly ttlHours: number;
    readonly now: Date;
    readonly newToken: () => string;
  },
): Promise<InboundAddressView> {
  if (!sameSecret(input.code.trim(), input.expectedCode)) {
    throw new UseCaseError("not_authorized", "El código de acceso no es válido", {
      action: "Escribe el código tal como lo recibiste",
      severity: "warning",
    });
  }
  const current = await loadInboundAddress(db, input.organizationId, input.base, input.now);
  if (current) return current;
  const token = input.newToken();
  const expiresAt = new Date(input.now.getTime() + input.ttlHours * HOUR_MS).toISOString();
  await insertInboundAddress(db, {
    token,
    organizationId: input.organizationId,
    createdAt: input.now.toISOString(),
    expiresAt,
  });
  return { address: inboundAddressFor(input.base, token), expiresAt };
}

export type InboundAdmission =
  /** Token desconocido o mal formado: no hay empresa a quien atribuirlo. No se registra. */
  | { readonly kind: "ignored" }
  /** Dirección vencida o tope alcanzado: queda en la bitácora de la empresa y no se procesa. */
  | { readonly kind: "rejected"; readonly organizationId: Ulid; readonly reason: RejectReason }
  | { readonly kind: "accepted"; readonly organizationId: Ulid; readonly receiptKey: ReceiptKey };

export type RejectReason = "expired" | "address_limit" | "daily_limit" | "invoice_limit";

/** Deja en la bitácora de la empresa que un correo no se procesó y por qué. */
export async function recordRejectedEmail(
  db: Database,
  input: {
    readonly organizationId: Ulid;
    readonly messageId: string;
    readonly reason: RejectReason;
    readonly now: Date;
    readonly newId: () => Ulid;
  },
): Promise<void> {
  // Sin remitente ni asunto: el registro dice que llegó un correo, no de quién.
  await appendEvent(db, {
    id: input.newId(),
    organization_id: input.organizationId,
    type: "email.rejected",
    actor: { kind: "agente" },
    invoice_id: null,
    decision_id: null,
    data: { reason: input.reason, message_id: input.messageId },
    trace_id: `tr-${input.newId()}`,
    occurred_at: input.now.toISOString(),
  });
}

/**
 * Decide si un correo se procesa. Un correo ya recibido (el proveedor lo reintenta) pasa sin
 * contar contra los topes: processInvoice lo reconoce por su llave y no lo repite.
 */
export async function admitInboundEmail(
  db: Database,
  input: {
    readonly email: InboundEmail;
    readonly limits: InboundLimits;
    readonly now: Date;
    /** Inicio del día de negocio, en ISO: desde cuándo cuentan los topes. */
    readonly since: string;
    readonly newId: () => Ulid;
  },
): Promise<InboundAdmission> {
  const token = (input.email.MailboxHash ?? "").trim().toLowerCase();
  if (!INBOUND_TOKEN.test(token)) return { kind: "ignored" };
  const address = await findInboundAddress(db, token);
  if (!address) return { kind: "ignored" };

  const organizationId = address.organizationId;
  const receiptKey = inboundReceiptKey(input.email.MessageID);
  if (await findInvoiceByReceiptKey(db, organizationId, receiptKey)) {
    return { kind: "accepted", organizationId, receiptKey };
  }

  const reject = async (reason: RejectReason): Promise<InboundAdmission> => {
    await recordRejectedEmail(db, {
      organizationId,
      messageId: input.email.MessageID,
      reason,
      now: input.now,
      newId: input.newId,
    });
    return { kind: "rejected", organizationId, reason };
  };

  if (address.expiresAt <= input.now.toISOString()) return reject("expired");
  const [mine, all] = await Promise.all([
    countInboundEmailsSince(db, organizationId, input.since),
    countInboundEmailsSince(db, null, input.since),
  ]);
  if (mine >= input.limits.maxPerAddressPerDay) return reject("address_limit");
  if (all >= input.limits.maxPerDay) return reject("daily_limit");
  return { kind: "accepted", organizationId, receiptKey };
}

const ATTACHMENT_MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
} as const;

const clip = (text: string | null | undefined, max: number): string => (text ?? "").slice(0, max);

/**
 * El correo como mensaje de canal que entiende la ingesta. El documento es el primer adjunto
 * que de verdad es PDF, PNG o JPEG (por contenido, no por nombre) y cabe en el tope; los
 * demás se ignoran. Sin adjunto válido, el correo entra igual y escala como "no es una
 * factura" sin llamar al modelo.
 */
export function inboundPayload(
  email: InboundEmail,
  input: { readonly now: Date; readonly maxBytes: number },
): { readonly bytes: Uint8Array; readonly originalName: string } {
  let attachment: ChannelPayload["attachment"] = null;
  for (const candidate of email.Attachments ?? []) {
    if (!candidate.Content) continue;
    // Base64 de más del tope ni se decodifica: cuatro caracteres son tres bytes.
    if (candidate.Content.length > Math.ceil(input.maxBytes / 3) * 4 + 4) continue;
    const bytes = new Uint8Array(Buffer.from(candidate.Content, "base64"));
    const type = sniffType(bytes);
    if (bytes.length === 0 || bytes.length > input.maxBytes) continue;
    if (type !== "pdf" && type !== "png" && type !== "jpeg") continue;
    attachment = {
      filename: clip(candidate.Name, 255) || `adjunto.${type === "jpeg" ? "jpg" : type}`,
      content_type: ATTACHMENT_MIME[type],
      data_base64: Buffer.from(bytes).toString("base64"),
    };
    break;
  }
  const sent = Date.parse(email.Date ?? "");
  const payload: ChannelPayload = {
    kind: "email",
    from: clip(email.From, 320) || "remitente desconocido",
    sent_at: new Date(Number.isNaN(sent) ? input.now.getTime() : sent).toISOString(),
    subject: email.Subject ? clip(email.Subject, 500) : null,
    body: clip(email.TextBody, 20_000),
    attachment,
  };
  return {
    bytes: new TextEncoder().encode(JSON.stringify(payload)),
    originalName: attachment?.filename ?? "correo.json",
  };
}
