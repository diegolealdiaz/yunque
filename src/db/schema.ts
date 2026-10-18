import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type {
  Actor,
  Agreement,
  BankAccount,
  ChecklistItem,
  ExtractedFieldName,
  ExtractionRecord,
  FieldSource,
  Finding,
  FxTable,
  PaymentOrderDraft,
  Policy,
  Verification,
} from "../domain"; // relativo: drizzle-kit no resuelve el alias "@/" al generar migraciones

/**
 * Esquema de la base. Reglas:
 * - Toda tabla lleva `organization_id`: multiempresa desde el inicio.
 * - Política, decisiones, aprobaciones y eventos son append-only; los triggers que lo
 *   imponen viven en la migración `append_only_triggers`.
 * - Fechas en texto ISO 8601 UTC. Dinero en enteros de unidad mínima con su moneda al lado.
 * - Los agregados ricos (cuenta, acuerdo, hallazgos, política) se guardan como JSON tipado;
 *   el repositorio los valida con el esquema zod del dominio al escribir y al leer.
 */

const id = (name: string) => text(name).notNull();
const timestamp = (name: string) => text(name).notNull();
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>().notNull();

export const organizations = sqliteTable(
  "organizations",
  {
    id: id("id").primaryKey(),
    name: text("name").notNull(),
    referencePrefix: text("reference_prefix").notNull(),
    baseCurrency: text("base_currency").notNull(),
    fx: json<FxTable>("fx"),
    demoVisitorId: text("demo_visitor_id"),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("organizations_demo_visitor_idx").on(t.demoVisitorId)],
);

export const balances = sqliteTable(
  "balances",
  {
    organizationId: id("organization_id").references(() => organizations.id),
    currency: text("currency").notNull(),
    available: integer("available").notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.currency] })],
);

export const ledgerPeriods = sqliteTable(
  "ledger_periods",
  {
    organizationId: id("organization_id").references(() => organizations.id),
    periodKey: text("period_key").notNull(),
    currency: text("currency").notNull(),
    limit: integer("limit").notNull(),
    committed: integer("committed").notNull().default(0),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.periodKey, t.currency] })],
);

/** Consecutivo de referencias legibles por empresa y mes. */
export const referenceCounters = sqliteTable(
  "reference_counters",
  {
    organizationId: id("organization_id").references(() => organizations.id),
    yearMonth: text("year_month").notNull(),
    nextSequence: integer("next_sequence").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.yearMonth] })],
);

export const vendors = sqliteTable(
  "vendors",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    name: text("name").notNull(),
    aliases: json<string[]>("aliases"),
    taxId: text("tax_id"),
    country: text("country").notNull(),
    account: json<BankAccount>("account"),
    verification: json<Verification>("verification"),
    agreement: json<Agreement>("agreement"),
    createdAt: timestamp("created_at"),
  },
  (t) => [index("vendors_org_idx").on(t.organizationId)],
);

/** Append-only. */
export const policyVersions = sqliteTable(
  "policy_versions",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    version: integer("version").notNull(),
    content: json<Policy>("content"),
    contentHash: text("content_hash").notNull(),
    signedBy: text("signed_by").notNull(),
    signedAt: timestamp("signed_at"),
    note: text("note"),
  },
  (t) => [uniqueIndex("policy_versions_org_version_idx").on(t.organizationId, t.version)],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    reference: text("reference").notNull(),
    channel: text("channel").notNull(),
    receiptKey: text("receipt_key").notNull(),
    sourceKind: text("source_kind").notNull(),
    documentHash: text("document_hash").notNull(),
    fileKey: text("file_key").notNull(),
    fileState: text("file_state").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageKeys: json<string[]>("page_keys"),
    text: text("text"),
    semanticKey: text("semantic_key"),
    // Fecha de emisión leída (ISO YYYY-MM-DD), para reglas que miran el periodo del cobro
    // en el historial, como el segundo pago de un recurrente. Null si no se leyó.
    issueDate: text("issue_date"),
    status: text("status").notNull(),
    approvalExpiresAt: text("approval_expires_at"),
    channelMeta: json<Record<string, string>>("channel_meta"),
    receivedAt: timestamp("received_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    // La entrega es la identidad idempotente; el documento puede repetirse (duplicado).
    uniqueIndex("invoices_org_receipt_key_idx").on(t.organizationId, t.receiptKey),
    index("invoices_org_document_hash_idx").on(t.organizationId, t.documentHash),
    uniqueIndex("invoices_org_reference_idx").on(t.organizationId, t.reference),
    index("invoices_org_semantic_key_idx").on(t.organizationId, t.semanticKey),
    index("invoices_org_status_idx").on(t.organizationId, t.status),
  ],
);

/** Extracción con la que se decidió cada factura, con su procedencia (modelo, prompt, esquema). */
export const extractions = sqliteTable(
  "extractions",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    invoiceId: id("invoice_id").references(() => invoices.id),
    documentHash: text("document_hash").notNull(),
    record: json<ExtractionRecord>("record"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("extractions_org_invoice_idx").on(t.organizationId, t.invoiceId),
    index("extractions_org_document_idx").on(t.organizationId, t.documentHash),
  ],
);

/**
 * Caché exacta del Lector, direccionada por contenido: la llave es el hash de (documento,
 * versión de prompt, versión de esquema, modelo, hash del prompt construido). No guarda
 * nada que no se derive del documento mismo.
 *
 * Excepción documentada a "toda tabla lleva organization_id": la columna `scope` vale el id
 * de la organización en producto, y un ámbito compartido en la demo pública, para que las
 * copias de cada visitante reutilicen las lecturas del dataset sin volver a pagar el modelo.
 */
export const extractionCache = sqliteTable(
  "extraction_cache",
  {
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    record: json<ExtractionRecord>("record"),
    createdAt: timestamp("created_at"),
  },
  (t) => [primaryKey({ columns: [t.scope, t.keyHash] })],
);

/** Append-only. */
export const decisions = sqliteTable(
  "decisions",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    invoiceId: id("invoice_id").references(() => invoices.id),
    verdict: text("verdict").notNull(),
    findings: json<Finding[]>("findings"),
    explanation: text("explanation").notNull(),
    summary: text("summary"),
    scheduledFor: text("scheduled_for"),
    paymentOrder: text("payment_order", { mode: "json" }).$type<PaymentOrderDraft | null>(),
    amount: integer("amount"),
    amountCurrency: text("amount_currency"),
    amountUsd: integer("amount_usd"),
    vendorId: text("vendor_id"),
    policyVersionId: id("policy_version_id").references(() => policyVersions.id),
    policyHash: text("policy_hash").notNull(),
    documentHash: text("document_hash").notNull(),
    extractionHash: text("extraction_hash"),
    fieldSources: json<Partial<Record<ExtractedFieldName, FieldSource>>>("field_sources"),
    previousDecisionId: text("previous_decision_id"),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull(),
    actor: json<Actor>("actor"),
    costUsdMicros: integer("cost_usd_micros").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => [
    index("decisions_org_invoice_idx").on(t.organizationId, t.invoiceId),
    index("decisions_org_decided_idx").on(t.organizationId, t.decidedAt),
    index("decisions_org_vendor_idx").on(t.organizationId, t.vendorId, t.decidedAt),
  ],
);

/** Append-only, salvo `consumed_at`, que pasa de null a un valor una sola vez. */
export const approvals = sqliteTable(
  "approvals",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    invoiceId: id("invoice_id").references(() => invoices.id),
    decisionId: id("decision_id").references(() => decisions.id),
    outcome: text("outcome").notNull(),
    approver: text("approver").notNull(),
    checklist: json<ChecklistItem[]>("checklist"),
    reason: text("reason"),
    payload: json<Record<string, unknown>>("payload"),
    signature: text("signature").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("approvals_org_decision_idx").on(t.organizationId, t.decisionId)],
);

/** Append-only. Única vía de escritura de la bitácora. */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    type: text("type").notNull(),
    actor: json<Actor>("actor"),
    invoiceId: text("invoice_id"),
    decisionId: text("decision_id"),
    data: json<Record<string, unknown>>("data"),
    traceId: text("trace_id").notNull(),
    occurredAt: timestamp("occurred_at"),
  },
  (t) => [
    index("audit_events_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("audit_events_org_invoice_idx").on(t.organizationId, t.invoiceId),
  ],
);

/** Outbox de notificaciones con llave de idempotencia y reintentos. */
export const notifications = sqliteTable(
  "notifications",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    channel: text("channel").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: json<Record<string, unknown>>("payload"),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    uniqueIndex("notifications_org_key_idx").on(t.organizationId, t.idempotencyKey),
    index("notifications_org_status_idx").on(t.organizationId, t.status),
  ],
);

/**
 * Direcciones de correo de entrada de la demo (D23): `token` es la parte después del + en la
 * dirección del proveedor y apunta a la empresa de un visitante. Vence sola en `expires_at`.
 */
export const inboundAddresses = sqliteTable(
  "inbound_addresses",
  {
    token: text("token").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    createdAt: timestamp("created_at"),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [index("inbound_addresses_org_expires_idx").on(t.organizationId, t.expiresAt)],
);

/**
 * Recibos del correo de entrada (D23): uno por correo que llega a una dirección conocida,
 * con el id que le da el proveedor. Un recibo admitido ocupa cupo del día; se escribe en la
 * misma transacción que cuenta el cupo, así una ráfaga de correos no pasa del tope.
 */
export const inboundReceipts = sqliteTable(
  "inbound_receipts",
  {
    messageId: text("message_id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    token: text("token")
      .notNull()
      .references(() => inboundAddresses.token),
    status: text("status").notNull(),
    reason: text("reason"),
    receivedAt: timestamp("received_at"),
  },
  (t) => [
    index("inbound_receipts_token_idx").on(t.token, t.status, t.receivedAt),
    index("inbound_receipts_org_idx").on(t.organizationId, t.status, t.receivedAt),
    index("inbound_receipts_received_idx").on(t.status, t.receivedAt),
  ],
);

/**
 * Acceso de cliente de la demo (D23, D24): quien escribe el código de acceso lo obtiene para
 * su empresa hasta `expires_at`. Abre la dirección de correo real y la conexión de Telegram.
 */
export const accessGrants = sqliteTable("access_grants", {
  organizationId: id("organization_id")
    .primaryKey()
    .references(() => organizations.id),
  grantedAt: timestamp("granted_at"),
  expiresAt: timestamp("expires_at"),
});

/**
 * Intentos fallidos del código de acceso, por empresa: base del límite de intentos. Un
 * intento correcto no se registra.
 */
export const accessAttempts = sqliteTable(
  "access_attempts",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    attemptedAt: timestamp("attempted_at"),
  },
  (t) => [index("access_attempts_org_idx").on(t.organizationId, t.attemptedAt)],
);

/** Chats de Telegram conectados a una empresa (D24). Un chat sirve a una sola empresa. */
export const telegramChats = sqliteTable(
  "telegram_chats",
  {
    chatId: text("chat_id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    linkedAt: timestamp("linked_at"),
  },
  (t) => [index("telegram_chats_org_idx").on(t.organizationId)],
);

/** Enlaces de conexión de Telegram: un solo uso, vencen solos. */
export const telegramLinkTokens = sqliteTable("telegram_link_tokens", {
  token: text("token").primaryKey(),
  organizationId: id("organization_id").references(() => organizations.id),
  createdAt: timestamp("created_at"),
  expiresAt: timestamp("expires_at"),
  usedAt: text("used_at"),
});

/**
 * Facturas enviadas al bot (D24): una fila por `update_id`, escrita en la misma transacción
 * que cuenta el cupo del chat. Un reintento de Telegram encuentra su fila y no cuenta dos veces.
 */
export const telegramUpdates = sqliteTable(
  "telegram_updates",
  {
    updateId: integer("update_id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    chatId: text("chat_id").notNull(),
    status: text("status").notNull(),
    receivedAt: timestamp("received_at"),
  },
  (t) => [index("telegram_updates_chat_idx").on(t.chatId, t.status, t.receivedAt)],
);

/**
 * Llave de la API de decisión de cada empresa (D32): una por empresa, guardada solo por su
 * huella. Generar otra la reemplaza y anula la anterior; vence con el acceso de cliente.
 */
export const apiKeys = sqliteTable("api_keys", {
  organizationId: id("organization_id")
    .primaryKey()
    .references(() => organizations.id),
  keyHash: text("key_hash").notNull().unique(),
  createdAt: timestamp("created_at"),
  expiresAt: timestamp("expires_at"),
});

/** Cada llamada al modelo, con costo y latencia. */
export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    invoiceId: text("invoice_id"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    promptHash: text("prompt_hash").notNull(),
    rawOutput: text("raw_output"),
    attempt: integer("attempt").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsdMicros: integer("cost_usd_micros"),
    latencyMs: integer("latency_ms").notNull(),
    status: text("status").notNull(),
    /** Motivo del intento fallido: plazo vencido, error del proveedor, salida fuera de esquema. */
    error: text("error"),
    traceId: text("trace_id").notNull(),
    createdAt: timestamp("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => [index("llm_calls_org_invoice_idx").on(t.organizationId, t.invoiceId)],
);

/**
 * Tablas que no admiten UPDATE, DELETE ni reemplazo por INSERT OR REPLACE (salvo la
 * excepción documentada en approvals). Los triggers viven en las migraciones; la prueba
 * P-42 recorre esta lista.
 */
export const APPEND_ONLY_TABLES = [
  "policy_versions",
  "decisions",
  "audit_events",
  "approvals",
] as const;
