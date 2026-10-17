import { z } from "zod";

import type { Database } from "@/src/db/client";
import {
  getCurrentPolicy,
  getInvoice,
  getLatestDecision,
  getLatestExtraction,
  getPolicyVersion,
  getVendor,
  listEvents,
} from "@/src/db/repositories";
import {
  EXTRACTED_FIELD_NAMES,
  FindingCodeSchema,
  formatMoney,
  isPresent,
  maskAccount,
  type AuditEvent,
  type ChecklistItem,
  type Decision,
  type ExtractedFieldName,
  type ExtractionRecord,
  type FieldSource,
  type Finding,
  type FindingCode,
  type Invoice,
  type Ulid,
  type Vendor,
} from "@/src/domain";
import { checklistFor } from "@/src/explain";
import { PageLayoutSchema, locateEvidence, type Box, type FileStorage } from "@/src/extraction";

/**
 * Detalle de una factura (docs/interfaz.md §5.2): todo lo que la pantalla necesita para
 * responder tres preguntas, qué dice el documento, qué decidió el agente y qué hago yo.
 * Solo lee y ordena; no recalcula nada del motor (docs/practicas.md 75).
 */

export type DetailField = {
  readonly name: ExtractedFieldName;
  /** Valor normalizado tal como lo guardó la extracción: texto o entero. */
  readonly value: string | number;
  readonly confidence: number;
  readonly source: FieldSource;
  /** Cadena exacta del documento de la que salió el valor. */
  readonly literal: string;
  /** Fragmento más amplio que la contiene. */
  readonly quote: string;
  readonly page: number;
  /** Dónde está la cita sobre la imagen de la página, si se pudo ubicar. */
  readonly box: Box | null;
};

export type RuleTrace = {
  readonly code: FindingCode;
  readonly outcome: "fail" | "pass" | "skipped" | "error";
  /** El hallazgo, para las que fallaron: valor observado, umbral, evidencia. */
  readonly finding: Finding | null;
};

export type TimelineItem = {
  readonly id: Ulid;
  readonly at: string;
  readonly type: AuditEvent["type"];
  readonly actor: string;
  readonly data: Readonly<Record<string, unknown>>;
};

export type InvoiceDetail = {
  readonly invoice: Invoice;
  readonly decision: Decision | null;
  readonly policyVersion: number | null;
  /** Hay una versión de política más nueva que la de la decisión: se puede reevaluar. */
  readonly newerPolicy: boolean;
  /** Mínimo de confianza de la política con que se decidió, para el punto de cada campo. */
  readonly minConfidence: number;
  readonly extraction: ExtractionRecord | null;
  readonly payeeName: string | null;
  /** Vendor registrado al que se le pagaría: su cuenta, nunca la del documento. */
  readonly vendor: Vendor | null;
  readonly fields: readonly DetailField[];
  /** Reglas en orden de lectura: primero las que fallaron, luego las demás. */
  readonly rules: readonly RuleTrace[];
  readonly timeline: readonly TimelineItem[];
  readonly checklist: readonly ChecklistItem[];
  /** Lo que firmará la aprobación, en claro. */
  readonly signatureSummary: string | null;
  /** Páginas con el tamaño real de su imagen, para reservar su espacio sin saltos. */
  readonly pages: readonly {
    readonly number: number;
    readonly width: number;
    readonly height: number;
  }[];
};

/** Tamaño por defecto si la imagen no es un PNG legible (proporción A4 a la resolución de ingesta). */
const DEFAULT_PAGE = { width: 910, height: 1287 } as const;

/** Ancho y alto de un PNG desde su cabecera IHDR, o null si no es un PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

async function pageSizes(storage: FileStorage, invoice: Invoice): Promise<InvoiceDetail["pages"]> {
  return Promise.all(
    invoice.page_keys.map(async (key, i) => {
      const size = await storage
        .get(key)
        .then(pngSize)
        .catch(() => null);
      return { number: i + 1, ...(size ?? DEFAULT_PAGE) };
    }),
  );
}

/** Lo que el evento de decisión guarda del registro del motor. */
const RuleLogSchema = z.array(
  z.object({
    code: FindingCodeSchema,
    outcome: z.enum(["fail", "pass", "skipped", "error"]),
  }),
);

const ORDER: Readonly<Record<RuleTrace["outcome"], number>> = {
  fail: 0,
  error: 0,
  pass: 1,
  skipped: 2,
};

/** Traza regla por regla: la del registro del motor, completada con los hallazgos. */
export function ruleTrace(decision: Decision, events: readonly AuditEvent[]): RuleTrace[] {
  const decided = events.find((e) => e.decision_id === decision.id);
  const parsed = RuleLogSchema.safeParse(decided?.data["rule_log"]);
  const log = parsed.success ? parsed.data : [];
  const findingByCode = new Map(decision.findings.map((f) => [f.code, f]));
  const traced: RuleTrace[] = log.map((entry) => ({
    code: entry.code,
    outcome: entry.outcome,
    finding: findingByCode.get(entry.code) ?? null,
  }));
  // Los hallazgos de sistema (pagos apagados, error de proceso) no están en el registro.
  for (const finding of decision.findings) {
    if (!traced.some((t) => t.code === finding.code)) {
      traced.push({ code: finding.code, outcome: "fail", finding });
    }
  }
  return traced
    .map((t, index) => ({ t, index }))
    .sort((a, b) => ORDER[a.t.outcome] - ORDER[b.t.outcome] || a.index - b.index)
    .map(({ t }) => t);
}

async function fieldsWithBoxes(
  storage: FileStorage,
  invoice: Invoice,
  extraction: ExtractionRecord | null,
): Promise<DetailField[]> {
  if (extraction?.extraction.kind !== "invoice") return [];
  const { fields } = extraction.extraction;
  // Una posición que no se puede leer no impide mostrar el detalle: la cita queda en el texto.
  const layouts = await Promise.all(
    invoice.page_keys.map(async (pngKey) => {
      const key = pngKey.replace(/pagina-(\d+)\.png$/, "texto-$1.json");
      if (key === pngKey) return null;
      try {
        const raw: unknown = JSON.parse(new TextDecoder().decode(await storage.get(key)));
        return PageLayoutSchema.parse(raw);
      } catch {
        return null;
      }
    }),
  );
  const out: DetailField[] = [];
  for (const name of EXTRACTED_FIELD_NAMES) {
    const field = fields[name];
    if (!isPresent(field)) continue;
    const page = field.evidence.page ?? 1;
    const layout = layouts[page - 1] ?? null;
    out.push({
      name,
      value: field.value,
      confidence: field.confidence,
      source: field.source,
      literal: field.evidence.literal,
      quote: field.evidence.quote,
      page,
      box: layout ? locateEvidence(layout, field.evidence.quote, field.evidence.literal) : null,
    });
  }
  return out;
}

export async function loadInvoiceDetail(
  db: Database,
  storage: FileStorage,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<InvoiceDetail> {
  const invoice = await getInvoice(db, organizationId, invoiceId);
  const [decision, stored, events, current] = await Promise.all([
    getLatestDecision(db, organizationId, invoiceId),
    getLatestExtraction(db, organizationId, invoiceId),
    listEvents(db, organizationId, { invoiceId, limit: 200 }),
    getCurrentPolicy(db, organizationId),
  ]);
  const [policy, vendor, fields, pages] = await Promise.all([
    decision ? getPolicyVersion(db, organizationId, decision.policy_version_id) : null,
    decision?.vendor_id ? getVendor(db, organizationId, decision.vendor_id) : null,
    fieldsWithBoxes(storage, invoice, stored?.record ?? null),
    pageSizes(storage, invoice),
  ]);
  const extraction = stored?.record ?? null;
  const readName =
    extraction?.extraction.kind === "invoice"
      ? extraction.extraction.fields.payee_name.value
      : null;
  const account = vendor ? maskAccount(vendor.account.account_number) : null;

  return {
    invoice,
    decision,
    policyVersion: policy?.version ?? null,
    newerPolicy: policy !== null && current !== null && current.version > policy.version,
    minConfidence: (policy ?? current)?.content.rules.field_low_confidence.min_confidence ?? 0.85,
    extraction,
    payeeName: vendor?.name ?? readName,
    vendor,
    fields,
    rules: decision ? ruleTrace(decision, events) : [],
    timeline: [...events].reverse().map((e) => ({
      id: e.id,
      at: e.occurred_at,
      type: e.type,
      actor: e.actor.kind === "agente" ? "agente" : e.actor.name,
      data: e.data,
    })),
    checklist: decision?.verdict === "escalar" ? checklistFor(decision.findings) : [],
    signatureSummary:
      decision && policy
        ? [
            `doc ${invoice.document_hash.slice(0, 6)}…`,
            `política v${String(policy.version)}`,
            [decision.amount ? formatMoney(decision.amount) : null, account ? `a ${account}` : null]
              .filter((p): p is string => p !== null)
              .join(" ") || null,
          ]
            .filter((p): p is string => p !== null)
            .join(", ")
        : null,
    pages,
  };
}
