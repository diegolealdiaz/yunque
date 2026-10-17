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
} from "../domain";

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
    status: text("status").notNull(),
    approvalExpiresAt: text("approval_expires_at"),
    channelMeta: json<Record<string, string>>("channel_meta"),
    receivedAt: timestamp("received_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    uniqueIndex("invoices_org_document_hash_idx").on(t.organizationId, t.documentHash),
    uniqueIndex("invoices_org_reference_idx").on(t.organizationId, t.reference),
    index("invoices_org_semantic_key_idx").on(t.organizationId, t.semanticKey),
    index("invoices_org_status_idx").on(t.organizationId, t.status),
  ],
);

/** Extracciones persistidas; sirven también de caché exacta por documento y versión de prompt. */
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

/** Cola outbox del lote: una fila por factura pendiente de procesar. */
export const jobs = sqliteTable(
  "jobs",
  {
    id: id("id").primaryKey(),
    organizationId: id("organization_id").references(() => organizations.id),
    invoiceId: id("invoice_id").references(() => invoices.id),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: text("locked_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [index("jobs_org_status_idx").on(t.organizationId, t.status)],
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
    traceId: text("trace_id").notNull(),
    createdAt: timestamp("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => [index("llm_calls_org_invoice_idx").on(t.organizationId, t.invoiceId)],
);

/** Tablas que no admiten UPDATE ni DELETE (salvo la excepción documentada en approvals). */
export const APPEND_ONLY_TABLES = [
  "policy_versions",
  "decisions",
  "audit_events",
  "approvals",
] as const;
