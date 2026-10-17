import { z } from "zod";

import { Sha256Schema, sha256Hex } from "./hash";
import { ReferenceSchema, UlidSchema } from "./ids";

/**
 * Invoice: el documento recibido y su estado de proceso. Los campos leídos viven en
 * `extraction.ts`; aquí está la identidad del archivo y la máquina de estados.
 */

export const ChannelSchema = z.enum(["upload", "batch", "inbox", "telegram", "api"]);
export type Channel = z.infer<typeof ChannelSchema>;

export const SourceKindSchema = z.enum(["pdf", "image", "email", "chat"]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/**
 * Estados de la factura. Las transiciones se hacen por comparación y cambio en la base.
 *
 *   recibida ──► procesando ──► decidida                 (pagar o frenar)
 *                   │     └────► esperando_aprobacion    (escalar)
 *                   │                  ├──► aprobada
 *                   │                  ├──► rechazada
 *                   │                  └──► procesando   (corrección de campos o replay)
 *                   ├──► fallida ──► procesando          (reintento)
 *                   └──► recibida                        (el trabajo se libera sin decidir)
 *   decidida ──► procesando                             (replay con política nueva)
 *
 * `aprobada` y `rechazada` son finales. `esperando_aprobacion` expira: ver `approval_expires_at`.
 */
export const InvoiceStatusSchema = z.enum([
  "recibida",
  "procesando",
  "decidida",
  "esperando_aprobacion",
  "aprobada",
  "rechazada",
  "fallida",
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

const TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  recibida: ["procesando"],
  procesando: ["decidida", "esperando_aprobacion", "fallida", "recibida"],
  decidida: ["procesando"],
  esperando_aprobacion: ["aprobada", "rechazada", "procesando"],
  aprobada: [],
  rechazada: [],
  fallida: ["procesando"],
};

/** Verdadero si la máquina de estados admite pasar de `from` a `to`. */
export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Estados desde los que no se sale. */
export function isFinalStatus(status: InvoiceStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** `canal:identificador`, solo caracteres seguros para logs y llaves. */
export const ReceiptKeySchema = z
  .string()
  .regex(/^[a-z]+:[A-Za-z0-9._:-]{1,190}$/, { error: "Llave de recepción inválida" });
export type ReceiptKey = z.infer<typeof ReceiptKeySchema>;

const SAFE_RECEIPT_ID = /^[A-Za-z0-9._:-]{1,190}$/;

/**
 * Llave de recepción para un canal y el identificador que ese canal da a la entrega. Un
 * identificador con caracteres no seguros (el Message-ID de un correo trae `<`, `@` y `>`)
 * se reemplaza por su hash: la llave sigue siendo estable para la misma entrega.
 */
export function receiptKeyFor(channel: Channel, id: string): ReceiptKey {
  const safe = SAFE_RECEIPT_ID.test(id) ? id : `h-${sha256Hex(id).slice(0, 40)}`;
  return ReceiptKeySchema.parse(`${channel}:${safe}`);
}

export const FileStateSchema = z.enum(["pendiente", "subida"]);

const MAX_CHANNEL_META_KEYS = 50;

export const InvoiceSchema = z.strictObject({
  id: UlidSchema,
  organization_id: UlidSchema,
  reference: ReferenceSchema,
  channel: ChannelSchema,
  /**
   * Llave de recepción: identifica la entrega, no el documento (id del correo, update de
   * Telegram, archivo del lote, o la llave de idempotencia que manda quien sube). Única por
   * organización: la misma entrega dos veces es una sola factura. El mismo archivo por otra
   * entrega sí es otra factura, y el motor la frena como duplicada.
   */
  receipt_key: ReceiptKeySchema,
  source_kind: SourceKindSchema,
  /** SHA-256 de los bytes del archivo original. Puede repetirse entre facturas: es un duplicado. */
  document_hash: Sha256Schema,
  /** Ruta o clave del archivo original en el almacenamiento. */
  file_key: z.string().min(1).max(500),
  file_state: FileStateSchema,
  /** Nombre que trajo el archivo, solo informativo. Nunca se usa como ruta. */
  original_name: z.string().max(255),
  mime_type: z.string().max(100),
  size_bytes: z.number().int().min(0),
  /** Páginas renderizadas a PNG, en orden. Vacío hasta que termina la normalización. */
  page_keys: z.array(z.string().min(1).max(500)).max(20),
  /** Texto normalizado del documento, si tiene capa de texto. */
  text: z.string().max(200_000).nullable(),
  /** Llave semántica normalizada, disponible tras la extracción. */
  semantic_key: z.string().max(500).nullable(),
  status: InvoiceStatusSchema,
  /** Vence la espera de aprobación; solo tiene valor en `esperando_aprobacion`. */
  approval_expires_at: z.iso.datetime().nullable(),
  /** Metadatos del canal: remitente y fecha de correo o chat. Nunca se muestran como HTML. */
  channel_meta: z
    .record(z.string().min(1).max(100), z.string().max(1000))
    .refine((m) => Object.keys(m).length <= MAX_CHANNEL_META_KEYS, {
      error: `channel_meta admite como máximo ${String(MAX_CHANNEL_META_KEYS)} claves`,
    })
    .default({}),
  received_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type Invoice = Readonly<z.infer<typeof InvoiceSchema>>;
