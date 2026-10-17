import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { GENERATED_DIR, loadBatchCases, mailboxMessageId } from "./demo-seed";

/**
 * Bandeja de correo simulada (docs/arquitectura.md "Canales"): los correos del dataset más
 * los mensajes sueltos de `data/dataset/bandeja/`, como los que llegarían a una casilla de
 * facturas. Cada mensaje tiene un Message-ID estable y su llave de recepción sale de él
 * (D13): leer la bandeja dos veces, o procesar el periodo y después leer la bandeja, no
 * recibe ningún correo dos veces.
 */

export const MAILBOX_DIR = path.join(process.cwd(), "data", "dataset", "bandeja");

export type MailboxMessage = {
  /** Id del caso del dataset o nombre del mensaje suelto: lo que el navegador pide. */
  readonly id: string;
  readonly messageId: string;
  /** Ruta del archivo del mensaje, elegida por el servidor. */
  readonly file: string;
  readonly from: string;
  readonly subject: string | null;
  readonly sentAt: string;
  readonly hasAttachment: boolean;
};

/** Solo la cabecera: el adjunto no hace falta para listar la bandeja. */
const HeaderSchema = z.object({
  kind: z.literal("email"),
  from: z.string().min(1).max(320),
  sent_at: z.iso.datetime(),
  subject: z.string().max(500).nullable(),
  attachment: z.object({ filename: z.string() }).nullable(),
});

async function readMessage(id: string, file: string): Promise<MailboxMessage> {
  const header = HeaderSchema.parse(JSON.parse(await readFile(file, "utf8")));
  return {
    id,
    messageId: mailboxMessageId(id),
    file,
    from: header.from,
    subject: header.subject,
    sentAt: header.sent_at,
    hasAttachment: header.attachment !== null,
  };
}

/** Los mensajes de la bandeja, el más viejo primero. */
export async function loadMailbox(): Promise<MailboxMessage[]> {
  const emails = (await loadBatchCases()).filter((c) => c.format === "email");
  const loose = (await readdir(MAILBOX_DIR)).filter((name) => name.endsWith(".email.json")).sort();
  const messages = await Promise.all([
    ...emails.map((c) => readMessage(c.id, path.join(GENERATED_DIR, c.file))),
    ...loose.map((name) =>
      readMessage(name.slice(0, -".email.json".length), path.join(MAILBOX_DIR, name)),
    ),
  ]);
  return messages.sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0));
}
