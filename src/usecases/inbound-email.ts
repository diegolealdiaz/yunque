import { z } from "zod";

import { withWriteTransaction, type Database, type Transaction } from "@/src/db/client";
import {
  appendEvent,
  countAdmittedByAddressSince,
  countAllAdmittedSince,
  countRejectedSince,
  findActiveInboundAddress,
  findInboundAddress,
  findInboundReceipt,
  insertInboundAddress,
  insertInboundReceipt,
} from "@/src/db/repositories";
import {
  InboundMessageIdSchema,
  InboundTokenSchema,
  inboundReceiptKey,
  type InboundRejectReason,
  type ReceiptKey,
  type Ulid,
} from "@/src/domain";
import { MIME_BY_TYPE, sniffType, type ChannelPayload } from "@/src/extraction";
import { inboundAddressFor } from "@/src/session";

import { UseCaseError } from "./errors";
import { assertWithinDailyLimits, type DailyLimits } from "./invoice-list";
import {
  processInvoice,
  type ProcessInvoiceDeps,
  type ProcessInvoiceResult,
} from "./process-invoice";

/**
 * Correo real de entrada de la demo (D23). El proveedor recibe el correo y lo entrega al
 * webhook; aquí se decide si se procesa, sin gastar nada antes de saberlo:
 *
 *   correo ─► token (lo que va después del +) ─► recibo en una transacción ─► processInvoice
 *               desconocido: se ignora            vencida o tope: rechazado
 *
 * Capas de protección:
 * 1. Solo quien tiene el acceso de jurado (`demo-access.ts`) obtiene una dirección.
 * 2. La dirección no se adivina (60 bits de azar) y vence con el acceso.
 * 3. Topes por dirección y de toda la demo, contados y reservados en la misma transacción
 *    que escribe el recibo: una ráfaga de correos no pasa del tope.
 * 4. El tope de gasto del proveedor del modelo, como techo final (fuera del código).
 * 5. Un interruptor en la configuración (fuera de este módulo: las rutas responden 404).
 * 6. Yunque nunca responde un correo.
 *
 * Cada correo a una dirección conocida deja un recibo con el id del proveedor. Un reintento
 * del proveedor encuentra su recibo y obtiene la misma respuesta, sin contar dos veces.
 */

/**
 * Lo que el proveedor de correo (Postmark) manda al webhook. Solo los campos que se usan;
 * el resto se ignora. Todo es contenido no confiable.
 */
export const InboundEmailSchema = z.object({
  MessageID: InboundMessageIdSchema,
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

export type InboundAdmission =
  /** Token desconocido o mal formado, o demasiados rechazos hoy: no se escribe nada. */
  | { readonly kind: "ignored" }
  /** Dirección vencida o tope alcanzado: queda su recibo y no se procesa. */
  | {
      readonly kind: "rejected";
      readonly organizationId: Ulid;
      readonly reason: InboundRejectReason;
    }
  /** Admitido: ocupa cupo del día y se procesa con esta llave de recepción. */
  | { readonly kind: "accepted"; readonly organizationId: Ulid; readonly receiptKey: ReceiptKey };

/**
 * Recibos rechazados que una empresa acumula por día. Pasado este número, un correo
 * rechazado no escribe nada: quien conoce una dirección vencida no puede llenar la base.
 */
export const MAX_REJECTED_PER_DAY = 20;

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
 * La dirección de la empresa mientras dure su acceso de jurado: la vigente si ya tiene una,
 * o una nueva que vence con el acceso. Leer y crear van en una transacción: dos pestañas a
 * la vez no dejan dos direcciones vigentes.
 */
export async function ensureInboundAddress(
  db: Database,
  input: {
    readonly organizationId: Ulid;
    readonly base: string;
    /** Vencimiento del acceso de jurado: la dirección no dura más que él. */
    readonly until: string;
    readonly now: Date;
    readonly newToken: () => string;
  },
): Promise<InboundAddressView> {
  const now = input.now.toISOString();
  const address = await withWriteTransaction(db, async (tx) => {
    const active = await findActiveInboundAddress(tx, input.organizationId, now);
    if (active) return active;
    const created = {
      token: input.newToken(),
      organizationId: input.organizationId,
      createdAt: now,
      expiresAt: input.until,
    };
    await insertInboundAddress(tx, created);
    return created;
  });
  return { address: inboundAddressFor(input.base, address.token), expiresAt: address.expiresAt };
}

/**
 * Deja constancia en la bitácora de que un correo no se procesó y por qué. Sin remitente
 * ni asunto: el registro dice que llegó un correo, no de quién.
 */
async function appendRejectionEvent(
  exec: Database | Transaction,
  input: {
    readonly organizationId: Ulid;
    readonly messageId: string;
    readonly reason: InboundRejectReason;
    readonly now: Date;
    readonly newId: () => Ulid;
  },
): Promise<void> {
  await appendEvent(exec, {
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
 * Decide si un correo se procesa y reserva su cupo. Todo ocurre en una transacción de
 * escritura: contar el cupo y escribir el recibo no se intercalan con otro correo.
 *
 * Un rechazo escribe su recibo y, solo la primera vez de cada motivo en el día, un evento
 * en la bitácora; pasados `MAX_REJECTED_PER_DAY` rechazos, no escribe nada.
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
  const token = InboundTokenSchema.safeParse((input.email.MailboxHash ?? "").trim().toLowerCase());
  if (!token.success) return { kind: "ignored" };
  const messageId = input.email.MessageID;
  const receiptKey = inboundReceiptKey(messageId);
  const now = input.now.toISOString();

  return withWriteTransaction(db, async (tx): Promise<InboundAdmission> => {
    const address = await findInboundAddress(tx, token.data);
    if (!address) return { kind: "ignored" };
    const organizationId = address.organizationId;

    // Reintento del proveedor: la misma respuesta que la primera vez, sin contar de nuevo.
    const previous = await findInboundReceipt(tx, messageId);
    if (previous) {
      return previous.status === "admitido"
        ? { kind: "accepted", organizationId: previous.organizationId, receiptKey }
        : { kind: "rejected", organizationId: previous.organizationId, reason: previous.reason };
    }

    const reject = async (reason: InboundRejectReason): Promise<InboundAdmission> => {
      if ((await countRejectedSince(tx, organizationId, input.since)) >= MAX_REJECTED_PER_DAY) {
        return { kind: "ignored" };
      }
      const firstOfReason =
        (await countRejectedSince(tx, organizationId, input.since, reason)) === 0;
      await insertInboundReceipt(tx, {
        messageId,
        organizationId,
        token: token.data,
        status: "rechazado",
        reason,
        receivedAt: now,
      });
      if (firstOfReason) {
        await appendRejectionEvent(tx, {
          organizationId,
          messageId,
          reason,
          now: input.now,
          newId: input.newId,
        });
      }
      return { kind: "rejected", organizationId, reason };
    };

    if (address.expiresAt <= now) return reject("expired");
    const byAddress = await countAdmittedByAddressSince(
      tx,
      organizationId,
      token.data,
      input.since,
    );
    if (byAddress >= input.limits.maxPerAddressPerDay) return reject("address_limit");
    if ((await countAllAdmittedSince(tx, input.since)) >= input.limits.maxPerDay) {
      return reject("daily_limit");
    }
    await insertInboundReceipt(tx, {
      messageId,
      organizationId,
      token: token.data,
      status: "admitido",
      reason: null,
      receivedAt: now,
    });
    return { kind: "accepted", organizationId, receiptKey };
  });
}

/**
 * Procesa un correo ya admitido: respeta los topes de facturas de la demo, arma el mensaje
 * de canal y lo pasa por el mismo camino que cualquier factura. Corre después de responder
 * al proveedor, así que nada se lanza: un tope o una falla quedan en la bitácora, y la
 * respuesta dice qué pasó para quien la llama (el log, en la ruta).
 */
export async function processInboundEmail(
  deps: ProcessInvoiceDeps,
  input: {
    readonly email: InboundEmail;
    readonly organizationId: Ulid;
    readonly receiptKey: ReceiptKey;
    readonly invoiceLimits: DailyLimits;
    readonly since: string;
    readonly now: Date;
  },
): Promise<
  | { readonly kind: "processed"; readonly result: ProcessInvoiceResult }
  | {
      readonly kind: "not_processed";
      readonly reason: InboundRejectReason;
      readonly error: unknown;
    }
> {
  const event = (reason: InboundRejectReason) =>
    appendRejectionEvent(deps.db, {
      organizationId: input.organizationId,
      messageId: input.email.MessageID,
      reason,
      now: input.now,
      newId: deps.newId,
    });
  try {
    await assertWithinDailyLimits(
      deps.db,
      input.organizationId,
      input.invoiceLimits,
      input.since,
      input.receiptKey,
    );
    const { bytes, originalName } = inboundPayload(input.email, {
      now: input.now,
      maxBytes: deps.limits.maxUploadBytes,
    });
    const result = await processInvoice(deps, {
      organizationId: input.organizationId,
      channel: "inbox",
      receiptKey: input.receiptKey,
      bytes,
      originalName,
    });
    return { kind: "processed", result };
  } catch (error) {
    const reason =
      error instanceof UseCaseError && error.code === "limit_reached" ? "invoice_limit" : "failed";
    // Si ni la bitácora se puede escribir, la falla original es la que importa.
    await event(reason).catch(() => undefined);
    return { kind: "not_processed", reason, error };
  }
}

const clip = (text: string | null | undefined, max: number): string => (text ?? "").slice(0, max);

/** Largo máximo en base64 de un archivo de `maxBytes`: cuatro caracteres por cada tres bytes. */
const base64Length = (maxBytes: number) => Math.ceil(maxBytes / 3) * 4;

/**
 * El correo como mensaje de canal que entiende la ingesta. El documento es el primer adjunto
 * que de verdad es PDF, PNG o JPEG (por contenido, no por nombre) y cabe en el tope; los
 * demás se ignoran. Sin adjunto válido, el correo entra igual y escala como "no es una
 * factura" sin llamar al modelo. Una fecha que no se entiende toma la hora de llegada.
 */
export function inboundPayload(
  email: InboundEmail,
  input: { readonly now: Date; readonly maxBytes: number },
): { readonly bytes: Uint8Array; readonly originalName: string } {
  let attachment: ChannelPayload["attachment"] = null;
  for (const candidate of email.Attachments ?? []) {
    // Un adjunto más grande que el tope ni se decodifica.
    if (!candidate.Content || candidate.Content.length > base64Length(input.maxBytes) + 4) continue;
    const bytes = new Uint8Array(Buffer.from(candidate.Content, "base64"));
    if (bytes.length === 0 || bytes.length > input.maxBytes) continue;
    const type = sniffType(bytes);
    if (type !== "pdf" && type !== "png" && type !== "jpeg") continue;
    attachment = {
      filename: clip(candidate.Name, 255) || `adjunto.${type === "jpeg" ? "jpg" : type}`,
      content_type: MIME_BY_TYPE[type],
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
