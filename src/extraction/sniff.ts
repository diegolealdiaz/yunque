import { z } from "zod";

import { IngestError } from "./errors";

/**
 * Tipo de archivo por contenido, nunca por extensión ni por el `Content-Type` que diga el
 * cliente. Un ejecutable con extensión .pdf o un PNG renombrado se rechazan aquí.
 */

export type SniffedType = "pdf" | "png" | "jpeg" | "json";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (bytes.length >= 5 && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (bytes.length >= 8 && startsWith(bytes, PNG_MAGIC)) return "png";
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // JSON de correo o chat: empieza por "{" tras un BOM opcional y espacios, en UTF-8.
  let i = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < bytes.length && i < 67 && [0x20, 0x09, 0x0a, 0x0d].includes(bytes[i] ?? -1)) i++;
  if (bytes[i] === 0x7b) return "json";
  return null;
}

export const MIME_BY_TYPE = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  json: "application/json",
} as const satisfies Record<SniffedType, string>;

/** Adjunto embebido en un correo o un chat: la factura en PDF o una foto de ella. */
const AttachmentSchema = z.strictObject({
  filename: z.string().min(1).max(255),
  /** Lo que dice el remitente. El tipo real se verifica por contenido al recibir. */
  content_type: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  data_base64: z.string().min(1).max(30_000_000),
});

export const ChannelPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("email"),
    from: z.string().min(1).max(320),
    sent_at: z.iso.datetime(),
    subject: z.string().max(500).nullable(),
    body: z.string().max(20_000),
    /** Un correo puede llegar sin factura adjunta: se recibe y se escala como ilegible. */
    attachment: AttachmentSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("chat"),
    from: z.string().min(1).max(200),
    sent_at: z.iso.datetime(),
    text: z.string().max(20_000),
    attachment: AttachmentSchema,
  }),
]);
export type ChannelPayload = z.infer<typeof ChannelPayloadSchema>;

/** Valida un JSON de correo o chat. El contenido es no confiable: solo se usa como datos. */
export function parseChannelPayload(bytes: Uint8Array): ChannelPayload {
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new IngestError(
      "invalid_channel_payload",
      "El archivo no es un JSON válido de correo o chat",
      "Sube el PDF directamente o un correo con el formato esperado",
    );
  }
  const parsed = ChannelPayloadSchema.safeParse(data);
  if (!parsed.success) {
    // El mensaje es para la persona: no describe el esquema interno ni repite el contenido.
    throw new IngestError(
      "invalid_channel_payload",
      "El JSON no es un correo ni un chat con adjunto que Yunque reconozca",
      "Sube la factura en PDF o como imagen",
    );
  }
  return parsed.data;
}
