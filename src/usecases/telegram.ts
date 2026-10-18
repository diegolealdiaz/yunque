import { withWriteTransaction, type Database } from "@/src/db/client";
import {
  consumeTelegramLink,
  countTelegramSince,
  deleteTelegramChat,
  findTelegramChat,
  findTelegramUpdate,
  getDecision,
  getInvoice,
  getLatestExtraction,
  getOrganization,
  insertTelegramLink,
  listInvoices,
  listLatestDecisions,
  insertTelegramUpdate,
  listTelegramChats,
  saveTelegramChat,
  type AccessGrant,
  type TelegramChat,
} from "@/src/db/repositories";
import {
  TELEGRAM_LINK_TTL_MS,
  TelegramLinkTokenSchema,
  UlidSchema,
  deliveredFromOutside,
  telegramReceiptKey,
  type Ulid,
} from "@/src/domain";
import { MIME_BY_TYPE, sniffType, type ChannelPayload } from "@/src/extraction";
import type { TelegramClient, TelegramMessage, TelegramUpdate } from "@/src/telegram";
import {
  TELEGRAM_TEXT,
  decisionNotice,
  sampleSummaryNotice,
  type SampleSummary,
} from "@/src/ui/telegram";

import { UseCaseError } from "./errors";
import { MAX_REJECTED_PER_DAY } from "./inbound-email";
import { assertWithinDailyLimits, type DailyLimits } from "./invoice-list";
import type { NotificationSender } from "./notifications";
import { processInvoice, type ProcessInvoiceDeps } from "./process-invoice";

/**
 * Telegram (D24): avisos de las decisiones a los chats conectados, y facturas que llegan
 * por el bot. Mismo modelo de protección que el correo real (D23):
 *
 * 1. Un chat solo se conecta con un enlace de un solo uso, que se genera con el acceso de
 *    cliente vigente y vence en una hora.
 * 2. El bot solo atiende chats conectados; a los demás les dice que es privado y no gasta.
 * 3. Cada factura enviada al bot ocupa cupo del chat por día, contado y reservado en la
 *    misma transacción que registra la entrega (`update_id`): una ráfaga no pasa del tope,
 *    y un reintento de Telegram no procesa dos veces.
 * 4. Los topes de facturas de la demo y el techo de gasto del modelo siguen valiendo.
 * 5. El bot solo escribe a chats conectados: no sirve para mandar mensajes a nadie más.
 *
 * El veredicto de una factura enviada al bot no se responde aquí: lo entrega la cola de
 * avisos, con reintentos, igual que el aviso de cualquier otra decisión.
 */

/** Qué se hizo con la actualización, para las pruebas y el log. */
export type TelegramOutcomeKind =
  | "ignored"
  | "private"
  | "linked"
  | "link_invalid"
  | "unlinked"
  | "help"
  | "duplicate"
  | "limit"
  | "too_large"
  | "processed"
  | "not_processed";

export type TelegramOutcome = {
  readonly kind: TelegramOutcomeKind;
  /** Empresa del chat, si está conectado: a quién entregarle los avisos después. */
  readonly organizationId: Ulid | null;
};

export type TelegramUpdateDeps = {
  readonly db: Database;
  readonly client: TelegramClient;
  readonly now: Date;
  /** Inicio del día de negocio, en ISO: desde cuándo cuentan los topes. */
  readonly since: string;
  readonly maxPerChatPerDay: number;
  readonly invoiceLimits: DailyLimits;
  /** Para procesar una factura enviada al bot; su `limits.maxUploadBytes` es el tope de archivo. */
  readonly process: ProcessInvoiceDeps;
};

/** Cuántos chats tiene conectados la empresa. */
export async function loadTelegramStatus(
  db: Database,
  organizationId: Ulid,
): Promise<{ readonly chats: number }> {
  return { chats: (await listTelegramChats(db, organizationId)).length };
}

/**
 * Enlace de conexión de un solo uso: `t.me/<bot>?start=<token>`. Vence en una hora o con el
 * acceso de cliente, lo que pase primero.
 */
export async function createTelegramLink(
  db: Database,
  input: {
    readonly organizationId: Ulid;
    readonly grant: AccessGrant;
    readonly botUsername: string;
    readonly now: Date;
    readonly newToken: () => string;
  },
): Promise<{ readonly url: string; readonly expiresAt: string }> {
  const hour = new Date(input.now.getTime() + TELEGRAM_LINK_TTL_MS).toISOString();
  const expiresAt = hour < input.grant.expiresAt ? hour : input.grant.expiresAt;
  const token = input.newToken();
  await insertTelegramLink(db, {
    token,
    organizationId: input.organizationId,
    createdAt: input.now.toISOString(),
    expiresAt,
    usedAt: null,
  });
  return { url: `https://t.me/${input.botUsername}?start=${token}`, expiresAt };
}

type Attachment = { readonly fileId: string; readonly size: number | null; readonly name: string };

/** El archivo de la factura en el mensaje: un documento, o la foto en su tamaño más grande. */
function attachmentOf(message: TelegramMessage): Attachment | null {
  if (message.document) {
    return {
      fileId: message.document.file_id,
      size: message.document.file_size ?? null,
      name: message.document.file_name ?? "factura",
    };
  }
  const photo = message.photo?.at(-1);
  return photo ? { fileId: photo.file_id, size: photo.file_size ?? null, name: "foto.jpg" } : null;
}

/**
 * Atiende una actualización de Telegram: decide qué es y la pasa a quien la resuelve.
 *
 *   /start <token>     ─► connectChat
 *   chat no conectado  ─► "bot privado"
 *   /salir             ─► desconecta
 *   documento o foto   ─► receiveInvoice
 *   otro texto         ─► ayuda
 *
 * Nunca lanza por el contenido del mensaje: responde al chat y devuelve qué hizo. Un error
 * de red al responder sí se propaga, para el log.
 */
export async function handleTelegramUpdate(
  deps: TelegramUpdateDeps,
  update: TelegramUpdate,
): Promise<TelegramOutcome> {
  const message = update.message;
  // Solo chats privados: el bot no atiende grupos ni canales.
  if (!message || message.chat.type !== "private") return { kind: "ignored", organizationId: null };
  const chatId = String(message.chat.id);
  const reply = (html: string) => deps.client.sendMessage(chatId, html);
  const text = (message.text ?? "").trim();

  if (text.startsWith("/start")) {
    return connectChat(deps, { chatId, argument: text.slice("/start".length).trim(), reply });
  }
  const chat = await findTelegramChat(deps.db, chatId);
  if (!chat) {
    await reply(TELEGRAM_TEXT.private);
    return { kind: "private", organizationId: null };
  }
  const done = (kind: TelegramOutcomeKind): TelegramOutcome => ({
    kind,
    organizationId: chat.organizationId,
  });
  if (text === "/salir") {
    await deleteTelegramChat(deps.db, chat.organizationId, chatId);
    await reply(TELEGRAM_TEXT.unlinked);
    return done("unlinked");
  }
  const file = attachmentOf(message);
  if (!file) {
    await reply(TELEGRAM_TEXT.help);
    return done("help");
  }
  return done(await receiveInvoice(deps, { update, message, chat, file, reply }));
}

/**
 * `/start <token>`: consume el enlace de un solo uso y conecta el chat a su empresa, en una
 * transacción. Un chat ya conectado que escribe /start sin enlace solo recibe la ayuda.
 */
async function connectChat(
  deps: TelegramUpdateDeps,
  input: {
    readonly chatId: string;
    readonly argument: string;
    readonly reply: (html: string) => Promise<void>;
  },
): Promise<TelegramOutcome> {
  const now = deps.now.toISOString();
  const token = TelegramLinkTokenSchema.safeParse(input.argument);
  const linked = token.success
    ? await withWriteTransaction(deps.db, async (tx) => {
        const link = await consumeTelegramLink(tx, token.data, now);
        if (!link) return null;
        await saveTelegramChat(tx, {
          chatId: input.chatId,
          organizationId: link.organizationId,
          linkedAt: now,
        });
        return link;
      })
    : null;
  if (linked) {
    const organization = await getOrganization(deps.db, linked.organizationId);
    await input.reply(TELEGRAM_TEXT.linked(organization.name));
    return { kind: "linked", organizationId: linked.organizationId };
  }
  const known = await findTelegramChat(deps.db, input.chatId);
  await input.reply(known ? TELEGRAM_TEXT.help : TELEGRAM_TEXT.linkInvalid);
  return known
    ? { kind: "help", organizationId: known.organizationId }
    : { kind: "link_invalid", organizationId: null };
}

/**
 * Registra la entrega y reserva su cupo en una transacción. Un `update_id` ya visto es un
 * reintento de Telegram. Pasado el cupo, la entrega queda rechazada; pasados
 * `MAX_REJECTED_PER_DAY` rechazos del chat, ya no se escribe nada.
 */
async function admitInvoice(
  deps: TelegramUpdateDeps,
  input: { readonly updateId: number; readonly chat: TelegramChat },
): Promise<"admitted" | "duplicate" | "limit" | "silenced"> {
  const { organizationId, chatId } = input.chat;
  return withWriteTransaction(deps.db, async (tx) => {
    if (await findTelegramUpdate(tx, input.updateId)) return "duplicate";
    const admitted = await countTelegramSince(tx, organizationId, chatId, "admitido", deps.since);
    if (admitted < deps.maxPerChatPerDay) {
      await insertTelegramUpdate(tx, {
        updateId: input.updateId,
        organizationId,
        chatId,
        status: "admitido",
        receivedAt: deps.now.toISOString(),
      });
      return "admitted";
    }
    const rejected = await countTelegramSince(tx, organizationId, chatId, "rechazado", deps.since);
    if (rejected >= MAX_REJECTED_PER_DAY) return "silenced";
    await insertTelegramUpdate(tx, {
      updateId: input.updateId,
      organizationId,
      chatId,
      status: "rechazado",
      receivedAt: deps.now.toISOString(),
    });
    return "limit";
  });
}

/**
 * Una factura enviada al bot: cupo, descarga acotada, mensaje de canal y `processInvoice`
 * con la llave `telegram:<update_id>`. El veredicto llega después por la cola de avisos.
 */
async function receiveInvoice(
  deps: TelegramUpdateDeps,
  input: {
    readonly update: TelegramUpdate;
    readonly message: TelegramMessage;
    readonly chat: TelegramChat;
    readonly file: Attachment;
    readonly reply: (html: string) => Promise<void>;
  },
): Promise<TelegramOutcomeKind> {
  const { chat, file, message, reply } = input;
  const admission = await admitInvoice(deps, { updateId: input.update.update_id, chat });
  if (admission === "duplicate") return "duplicate";
  if (admission === "silenced") return "limit";
  if (admission === "limit") {
    await reply(TELEGRAM_TEXT.limit(deps.maxPerChatPerDay));
    return "limit";
  }

  const maxBytes = deps.process.limits.maxUploadBytes;
  const tooLarge = () => reply(TELEGRAM_TEXT.tooLarge(Math.floor(maxBytes / 1_048_576)));
  if (file.size !== null && file.size > maxBytes) {
    await tooLarge();
    return "too_large";
  }
  await reply(TELEGRAM_TEXT.received);
  const receiptKey = telegramReceiptKey(input.update.update_id);
  try {
    const bytes = await deps.client.downloadFile(file.fileId, maxBytes);
    if (bytes === null) {
      await tooLarge();
      return "too_large";
    }
    const type = sniffType(bytes);
    if (type !== "pdf" && type !== "png" && type !== "jpeg") {
      await reply(TELEGRAM_TEXT.notProcessed("no es un PDF ni una imagen PNG o JPEG."));
      return "not_processed";
    }
    const payload: ChannelPayload = {
      kind: "chat",
      from: message.from?.first_name ?? "Telegram",
      sent_at: new Date(message.date * 1000).toISOString(),
      text: message.caption ?? "",
      attachment: {
        filename: file.name,
        content_type: MIME_BY_TYPE[type],
        data_base64: Buffer.from(bytes).toString("base64"),
      },
    };
    await assertWithinDailyLimits(
      deps.db,
      chat.organizationId,
      deps.invoiceLimits,
      deps.since,
      receiptKey,
    );
    await processInvoice(deps.process, {
      organizationId: chat.organizationId,
      channel: "telegram",
      receiptKey,
      bytes: new TextEncoder().encode(JSON.stringify(payload)),
      originalName: file.name,
    });
    return "processed";
  } catch (error) {
    // Los errores de los casos de uso traen un mensaje para la persona; los demás no se
    // describen al chat.
    await reply(
      TELEGRAM_TEXT.notProcessed(
        error instanceof UseCaseError
          ? `${error.message}. ${error.action}.`
          : "inténtalo de nuevo en un rato.",
      ),
    );
    return "not_processed";
  }
}

/**
 * Entrega los avisos del canal Telegram a los chats conectados de la empresa: qué pasó, de
 * quién y cuánto, por qué y un botón al detalle si hay URL pública. Sin chats conectados el
 * aviso queda simulado (D21), como antes de existir el bot.
 *
 * Con varios chats, un reintento puede repetir el aviso en los que ya lo recibieron: se
 * prefiere un aviso repetido a uno perdido.
 */
export function telegramSender(deps: {
  readonly db: Database;
  readonly client: TelegramClient;
  readonly publicAppUrl: string | null;
}): NotificationSender {
  return async (notification) => {
    const chats = await listTelegramChats(deps.db, notification.organization_id);
    if (chats.length === 0) return { simulated: true };
    const invoiceId = UlidSchema.parse(notification.payload["invoice_id"]);
    const decisionId = UlidSchema.parse(notification.payload["decision_id"]);
    const org = notification.organization_id;
    const [invoice, decision, stored] = await Promise.all([
      getInvoice(deps.db, org, invoiceId),
      getDecision(deps.db, org, decisionId),
      getLatestExtraction(deps.db, org, invoiceId),
    ]);
    const extraction = stored?.record.extraction;
    const html = decisionNotice({
      verdict: decision.verdict,
      status: invoice.status,
      reference: invoice.reference,
      payeeName:
        decision.payment_order?.beneficiary_name ??
        (extraction?.kind === "invoice" ? extraction.fields.payee_name.value : null),
      amount: decision.amount,
      findings: decision.findings,
      approvedBy: decision.actor.kind === "humano" ? decision.actor.name : null,
    });
    const button = deps.publicAppUrl
      ? { text: "Abrir en Yunque", url: `${deps.publicAppUrl}/facturas/${invoice.id}` }
      : undefined;
    for (const chat of chats) await deps.client.sendMessage(chat.chatId, html, button);
    return { simulated: false };
  };
}

/**
 * Cómo quedaron las facturas de ejemplo de hoy (lote y bandeja simulada): las que no
 * entregó una persona ni vienen del historial sembrado, por su veredicto vigente.
 */
export async function summarizeSamples(
  db: Database,
  organizationId: Ulid,
  since: string,
): Promise<SampleSummary> {
  const invoices = (await listInvoices(db, organizationId, { limit: 500 })).filter(
    (invoice) =>
      invoice.received_at >= since &&
      !invoice.receipt_key.startsWith("seed:") &&
      !deliveredFromOutside(invoice.receipt_key),
  );
  const decisions = await listLatestDecisions(
    db,
    organizationId,
    invoices.map((invoice) => invoice.id),
  );
  const summary = { total: 0, pagar: 0, escalar: 0, frenar: 0 };
  for (const decision of decisions.values()) {
    summary.total += 1;
    summary[decision.verdict] += 1;
  }
  return summary;
}

/**
 * Manda a los chats conectados el resumen de las facturas de ejemplo, con un botón a
 * Pendientes si hay URL pública. Lo pide la pantalla al terminar el lote; no pasa por la
 * cola de avisos porque es un resumen que se puede volver a pedir, no un aviso por decisión.
 */
export async function sendSampleSummary(
  deps: {
    readonly db: Database;
    readonly client: TelegramClient;
    readonly publicAppUrl: string | null;
  },
  input: { readonly organizationId: Ulid; readonly since: string },
): Promise<{ readonly sent: boolean; readonly summary: SampleSummary }> {
  const [chats, summary] = await Promise.all([
    listTelegramChats(deps.db, input.organizationId),
    summarizeSamples(deps.db, input.organizationId, input.since),
  ]);
  if (chats.length === 0 || summary.total === 0) return { sent: false, summary };
  const html = sampleSummaryNotice(summary);
  const button = deps.publicAppUrl
    ? { text: "Ver pendientes", url: `${deps.publicAppUrl}/pendientes` }
    : undefined;
  for (const chat of chats) await deps.client.sendMessage(chat.chatId, html, button);
  return { sent: true, summary };
}
