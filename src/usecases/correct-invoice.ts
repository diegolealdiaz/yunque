import { withWriteTransaction } from "@/src/db/client";
import { DbError } from "@/src/db/errors";
import {
  appendEvent,
  getCurrentPolicy,
  getInvoice,
  getLatestDecision,
  getLatestExtraction,
  getOrganization,
  listVendors,
  transitionInvoice,
} from "@/src/db/repositories";
import {
  EXTRACTED_FIELD_NAMES,
  ExtractedFieldNameSchema,
  ExtractionSchema,
  isPresent,
  jsonHash,
  type Ambiguity,
  type Decision,
  type ExtractedFieldName,
  type ExtractedFields,
  type Extraction,
  type ExtractionRecord,
  type Invoice,
  type InvoiceStatus,
  type Suspicion,
  type Ulid,
} from "@/src/domain";
import type { PayeeMatch } from "@/src/engine";
import {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  amountFromLiteral,
  datesFromLiteral,
  detectAll,
  verifyExtraction,
} from "@/src/extraction";
import { resolvePayee } from "@/src/resolve";

import { auditEvent, decideAndRecord, type DecideDeps, type Reading } from "./decide";
import { escalateOnFailure } from "./escalate-on-failure";
import { StageFailure, inStage } from "./stage";

/**
 * Corrección de campos a mano y reevaluación (docs/arquitectura.md §4b y §5, invariante 4).
 *
 * - Corregir: una persona de la lista de aprobadores reemplaza valores leídos de una
 *   escalada. Los campos corregidos quedan con origen "humano" y el motor vuelve a correr con
 *   la política vigente. Nunca paga solo: si el resultado fuera `pagar`, escala con
 *   `human_correction` para que otra persona lo apruebe (cuatro ojos).
 * - Reevaluar: el motor vuelve a correr sobre la misma lectura con la política vigente, para
 *   una escalada o una frenada. Una factura ya pagada no se reevalúa: comprometería dos veces.
 *
 * En los dos casos una señal de instrucciones sospechosas de la decisión anterior se arrastra
 * a la nueva: el cuerpo del correo no se guarda, y una reevaluación nunca puede ablandar.
 */

export type CorrectionErrorCode =
  | "not_found"
  | "not_correctable"
  | "not_authorized"
  | "invalid_value"
  | "missing_required"
  | "nothing_changed";

export class CorrectionError extends Error {
  readonly code: CorrectionErrorCode;
  readonly field: ExtractedFieldName | null;
  readonly action: string;
  constructor(
    code: CorrectionErrorCode,
    message: string,
    action: string,
    field: ExtractedFieldName | null = null,
  ) {
    super(message);
    this.name = "CorrectionError";
    this.code = code;
    this.action = action;
    this.field = field;
  }
}

/** Campos sin los cuales no hay factura que evaluar. */
const REQUIRED: readonly ExtractedFieldName[] = [
  "payee_name",
  "invoice_number",
  "currency",
  "total",
];
const MONEY: ReadonlySet<ExtractedFieldName> = new Set(["subtotal", "taxes", "total"]);
const DATES: ReadonlySet<ExtractedFieldName> = new Set(["issue_date", "due_date"]);

/** Nombre del modelo que queda en el registro de una lectura corregida a mano. */
export const HUMAN_READER = "correccion-manual";

/**
 * Valor de un campo como lo edita la persona: montos con dos decimales y punto, fechas ISO,
 * el resto tal cual. Es también contra lo que se compara para saber qué cambió.
 */
export function editableValue(fields: ExtractedFields | null, name: ExtractedFieldName): string {
  const field = fields?.[name];
  if (!field || !isPresent(field)) return "";
  const value = field.value;
  if (typeof value === "number" && MONEY.has(name)) return (value / 100).toFixed(2);
  return String(value);
}

/** Interpreta lo que escribió la persona para un campo; lanza `invalid_value` si no sirve. */
function parseValue(name: ExtractedFieldName, raw: string): string | number {
  const invalid = (detail: string) =>
    new CorrectionError("invalid_value", detail, "Corrige el valor y vuelve a enviar", name);
  if (MONEY.has(name)) {
    const amount = amountFromLiteral(raw);
    if (amount === null || amount < 0) throw invalid("El monto no es un número válido");
    if (name === "total" && amount === 0) throw invalid("El total debe ser mayor que cero");
    return amount;
  }
  if (name === "hours") {
    if (!/^\d{1,5}$/.test(raw)) throw invalid("Las horas deben ser un número entero");
    return Number(raw);
  }
  if (DATES.has(name)) {
    const [date, other] = datesFromLiteral(raw);
    if (!date || other) throw invalid("La fecha no es válida o es ambigua; usa AAAA-MM-DD");
    return date;
  }
  if (name === "currency") {
    if (!/^[A-Za-z]{3}$/.test(raw)) throw invalid("La moneda es un código de tres letras");
    return raw.toUpperCase();
  }
  return raw;
}

/**
 * Extracción nueva a partir de la anterior y lo que la persona escribió. Solo cambia lo que
 * difiere del valor vigente, más lo que la persona confirmó sin cambiarlo (un total ambiguo
 * que el Lector leyó bien): esos campos pasan a origen humano con el mismo valor. Un campo
 * obligatorio no se puede vaciar.
 */
export function correctedExtraction(
  base: Extraction | null,
  submitted: Readonly<Partial<Record<ExtractedFieldName, string>>>,
  actor: string,
  confirmed: readonly ExtractedFieldName[] = [],
): { readonly extraction: Extraction; readonly changed: readonly ExtractedFieldName[] } {
  const current = base?.kind === "invoice" ? base.fields : null;
  const changed: ExtractedFieldName[] = [];
  const replaced: Partial<Record<ExtractedFieldName, unknown>> = {};
  for (const name of EXTRACTED_FIELD_NAMES) {
    const raw = submitted[name];
    const existing = current?.[name];
    const sameAsRead = raw === undefined || raw.trim() === editableValue(current, name);
    if (sameAsRead && confirmed.includes(name) && existing && isPresent(existing)) {
      changed.push(name);
      replaced[name] = { ...existing, confidence: 1, source: "humano" };
      continue;
    }
    if (raw === undefined) continue;
    const text = raw.trim();
    if (sameAsRead) continue;
    changed.push(name);
    if (text === "") {
      if (REQUIRED.includes(name)) {
        throw new CorrectionError(
          "missing_required",
          "Ese campo es obligatorio para evaluar la factura",
          "Escribe el valor que muestra el documento",
          name,
        );
      }
      replaced[name] = { value: null, reason: `vaciado a mano por ${actor}` };
      continue;
    }
    replaced[name] = {
      value: parseValue(name, text),
      evidence: { literal: text.slice(0, 500), quote: text.slice(0, 2000), page: null },
      confidence: 1,
      source: "humano",
    };
  }
  if (changed.length === 0) {
    throw new CorrectionError(
      "nothing_changed",
      "No cambiaste ningún campo",
      "Edita al menos un valor",
    );
  }

  const fields: Record<string, unknown> = {};
  for (const name of EXTRACTED_FIELD_NAMES) {
    const value = replaced[name] ?? current?.[name];
    if (value === undefined) {
      if (REQUIRED.includes(name)) {
        throw new CorrectionError(
          "missing_required",
          "Sin lectura del documento hay que completar beneficiario, número, moneda y total",
          "Completa los cuatro campos obligatorios",
          name,
        );
      }
      fields[name] = { value: null, reason: "no se leyó y no se completó a mano" };
    } else {
      fields[name] = value;
    }
  }
  const candidate: unknown = {
    kind: "invoice",
    fields,
    // Lo que la persona fijó ya no es ambiguo; el resto de ambigüedades del Lector se queda.
    ambiguities:
      base?.kind === "invoice" ? base.ambiguities.filter((a) => !changed.includes(a.field)) : [],
    suspicions: base && base.kind !== "unreadable" ? base.suspicions : [],
    language: base?.kind === "invoice" ? base.language : "es",
  };
  const parsed = ExtractionSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const name = EXTRACTED_FIELD_NAMES.find((n) => issue?.path.includes(n)) ?? null;
    throw new CorrectionError(
      "invalid_value",
      "Un valor corregido no tiene el formato esperado",
      "Revisa el campo marcado",
      name,
    );
  }
  return { extraction: parsed.data, changed };
}

/**
 * La lectura que se vuelve a evaluar: la extracción guardada, verificada otra vez contra el
 * texto del documento, más las señales de instrucciones sospechosas del Detector y de la
 * decisión anterior, y las ambigüedades que la verificación no puede recalcular (dos pasadas
 * del modelo que leyeron distinto). La usan la reevaluación y la vista previa de un cambio de
 * política.
 */
export function readingFor(
  invoice: Invoice,
  previous: Decision,
  record: ExtractionRecord,
): Reading {
  const verified = verifyExtraction(record.extraction, invoice.text);
  return {
    record,
    verification: {
      ...verified.report,
      ambiguities: [
        ...verified.report.ambiguities,
        ...carriedAmbiguities(previous, record.extraction),
      ],
      suspicions: [
        ...verified.report.suspicions,
        ...detectAll({
          document: invoice.text ?? "",
          channel: invoice.channel_meta["subject"] ?? null,
        }),
        ...carriedSuspicions(previous),
      ],
    },
    cost_usd_micros: 0,
    latency_ms: 0,
  };
}

/**
 * Ambigüedades de la decisión anterior. Algunas no salen de verificar la lectura guardada
 * (las dos pasadas del modelo leyeron montos distintos), y un cambio de política no las
 * resuelve: sin esto, subir el umbral pagaría un monto que nadie confirmó. Solo deja de
 * contar la de un campo que una persona ya corrigió o confirmó.
 */
function carriedAmbiguities(previous: Decision, extraction: Extraction): Ambiguity[] {
  const fields = extraction.kind === "invoice" ? extraction.fields : null;
  const out: Ambiguity[] = [];
  for (const finding of previous.findings) {
    if (finding.code !== "field_ambiguous") continue;
    const field = ExtractedFieldNameSchema.safeParse(finding.field);
    if (!field.success) continue;
    const current = fields?.[field.data];
    if (current && isPresent(current) && current.source === "humano") continue;
    const candidates = finding.observed
      .split(" | ")
      .filter((c) => c.length > 0)
      .slice(0, 10)
      .map((c) => c.slice(0, 500));
    out.push({
      field: field.data,
      candidates: candidates.length >= 2 ? candidates : [finding.observed, "otro valor"],
    });
  }
  return out;
}

/** Señales de inyección de la decisión anterior, para que ninguna reevaluación las pierda. */
function carriedSuspicions(previous: Decision): Suspicion[] {
  return previous.findings
    .filter((f) => f.code === "suspicious_instructions")
    .map((f) => ({ kind: "instruction_to_agent", quote: f.evidence?.quote ?? f.observed }));
}

type ReevaluationArgs = {
  readonly organizationId: Ulid;
  readonly invoiceId: Ulid;
  /** Aprobador de la cookie verificada. */
  readonly actor: string | null;
  readonly traceId?: string;
};

async function authorize(deps: DecideDeps, args: ReevaluationArgs): Promise<string> {
  const policy = await getCurrentPolicy(deps.db, args.organizationId);
  if (args.actor === null || !policy?.content.protected.approvers.includes(args.actor)) {
    throw new CorrectionError(
      "not_authorized",
      "Quien corrige no está en la lista de aprobadores de la política",
      "Elige un aprobador de la lista",
    );
  }
  return args.actor;
}

async function loadInvoice(deps: DecideDeps, args: ReevaluationArgs): Promise<Invoice> {
  return getInvoice(deps.db, args.organizationId, args.invoiceId).catch((error: unknown) => {
    if (error instanceof DbError && error.code === "not_found") {
      throw new CorrectionError("not_found", "La factura no existe", "Vuelve a pendientes");
    }
    throw error;
  });
}

/** Lleva la factura a `procesando`, evalúa la lectura y registra, o escala si algo falla. */
async function reevaluate(
  deps: DecideDeps,
  input: {
    readonly invoice: Invoice;
    readonly from: InvoiceStatus;
    readonly previous: Decision;
    readonly record: ExtractionRecord;
    readonly actor: string;
    readonly correctedFields: readonly ExtractedFieldName[] | null;
    readonly traceId: string;
  },
): Promise<{ readonly invoice: Invoice; readonly decision: Decision }> {
  const { invoice, previous, record, actor, traceId } = input;
  const organization = await getOrganization(deps.db, invoice.organization_id);
  const at = deps.now().toISOString();
  try {
    await withWriteTransaction(deps.db, async (tx) => {
      await transitionInvoice(
        tx,
        invoice.organization_id,
        invoice.id,
        input.from,
        "procesando",
        at,
      );
      await appendEvent(
        tx,
        auditEvent(deps, {
          type: input.correctedFields ? "invoice.corrected" : "invoice.processing",
          actor: { kind: "humano", name: actor },
          invoice,
          data: input.correctedFields
            ? { fields: input.correctedFields, previous_decision_id: previous.id }
            : { reevaluation: true, previous_decision_id: previous.id },
          traceId,
          at,
        }),
      );
    });
  } catch (error) {
    if (error instanceof DbError && error.code === "stale_state") {
      throw new CorrectionError(
        "not_correctable",
        "Otra persona cambió esta factura mientras la revisabas",
        "Recarga la página para ver cómo quedó",
      );
    }
    throw error;
  }

  const working: Invoice = { ...invoice, status: "procesando", updated_at: at };
  try {
    const extraction = record.extraction;
    const reading = readingFor(invoice, previous, record);
    const payee: PayeeMatch = await inStage("resolve", async () =>
      extraction.kind === "invoice"
        ? resolvePayee(extraction.fields, await listVendors(deps.db, invoice.organization_id))
        : { kind: "unknown", closest: null },
    );
    const decided = await decideAndRecord(deps, {
      organization,
      invoice: working,
      reading,
      payee,
      pipelineEvents: [],
      traceId,
      actor: input.correctedFields ? { kind: "humano", name: actor } : { kind: "agente" },
      previousDecisionId: previous.id,
      documentPatch: null,
    });
    return { invoice: decided.invoice, decision: decided.decision };
  } catch (error) {
    const failure = error instanceof StageFailure ? error : new StageFailure("record", error);
    const policyVersion = await getCurrentPolicy(deps.db, invoice.organization_id);
    if (!policyVersion) throw error;
    return escalateOnFailure(deps, {
      organization,
      policyVersion,
      invoice: working,
      failure,
      traceId,
    });
  }
}

/** Corrige campos de una escalada y la vuelve a evaluar con la política vigente. */
export async function correctAndReevaluate(
  deps: DecideDeps,
  input: ReevaluationArgs & {
    readonly submitted: Readonly<Partial<Record<ExtractedFieldName, string>>>;
    /** Campos que la persona confirma tal como se leyeron. */
    readonly confirmed?: readonly ExtractedFieldName[];
  },
): Promise<{ readonly invoice: Invoice; readonly decision: Decision }> {
  const actor = await authorize(deps, input);
  const invoice = await loadInvoice(deps, input);
  const previous = await getLatestDecision(deps.db, invoice.organization_id, invoice.id);
  if (invoice.status !== "esperando_aprobacion" || previous?.verdict !== "escalar") {
    throw new CorrectionError(
      "not_correctable",
      "Solo se corrige una factura que espera una decisión",
      "Si está frenada y cambió la política, reevalúala",
    );
  }
  const stored = await getLatestExtraction(deps.db, invoice.organization_id, invoice.id);
  const { extraction, changed } = correctedExtraction(
    stored?.record.extraction ?? null,
    input.submitted,
    actor,
    input.confirmed ?? [],
  );
  const record: ExtractionRecord = {
    extraction,
    extraction_hash: jsonHash(extraction),
    model: HUMAN_READER,
    prompt_version: stored?.record.prompt_version ?? PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    fallback_used: false,
  };
  return reevaluate(deps, {
    invoice,
    from: "esperando_aprobacion",
    previous,
    record,
    actor,
    correctedFields: changed,
    traceId: input.traceId ?? `tr-${deps.newId()}`,
  });
}

/**
 * Vuelve a evaluar la misma lectura con la política vigente. Para una escalada o una
 * frenada; nunca para una ya pagada.
 */
export async function reevaluateWithCurrentPolicy(
  deps: DecideDeps,
  input: ReevaluationArgs,
): Promise<{ readonly invoice: Invoice; readonly decision: Decision }> {
  const actor = await authorize(deps, input);
  const invoice = await loadInvoice(deps, input);
  const previous = await getLatestDecision(deps.db, invoice.organization_id, invoice.id);
  const waiting = invoice.status === "esperando_aprobacion" && previous?.verdict === "escalar";
  const stopped = invoice.status === "decidida" && previous?.verdict === "frenar";
  if (!previous || (!waiting && !stopped)) {
    throw new CorrectionError(
      "not_correctable",
      "Solo se reevalúa una factura escalada o frenada; una pagada ya comprometió presupuesto",
      "Recarga la página para ver cómo quedó",
    );
  }
  const stored = await getLatestExtraction(deps.db, invoice.organization_id, invoice.id);
  if (!stored) {
    throw new CorrectionError(
      "not_correctable",
      "La factura no tiene una lectura que reevaluar",
      "Reenvía la misma factura para reprocesarla, o corrige los campos a mano",
    );
  }
  return reevaluate(deps, {
    invoice,
    from: waiting ? "esperando_aprobacion" : "decidida",
    previous,
    record: stored.record,
    actor,
    correctedFields: null,
    traceId: input.traceId ?? `tr-${deps.newId()}`,
  });
}
