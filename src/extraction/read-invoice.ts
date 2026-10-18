import {
  isPresent,
  jsonHash,
  type Ambiguity,
  type Extraction,
  type ExtractionRecord,
  type Suspicion,
} from "@/src/domain";
import type { VerificationReport } from "@/src/engine";

import { detectAll } from "./detector";
import type { IngestedDocument } from "./ingest";
import type { PromptInput } from "./prompt";
import {
  MIN_ATTEMPT_MS,
  readDocument,
  remainingMs,
  type ReadResult,
  type ReaderDeps,
} from "./reader";
import type { FileStorage } from "./storage";
import { needsFallback, valueDerived, verifyExtraction, type Verification } from "./verify";

/**
 * Lectura completa de una factura: Lector con el modelo principal, Verificador, y una sola
 * segunda pasada con el modelo de respaldo si la primera fue ilegible o la verificación
 * encontró citas o valores que no cuadran. Si también falla, se sigue con los hallazgos.
 * El Detector suma sus señales al informe. Nunca hay bucle, y todo cabe en un plazo
 * global: si no queda tiempo para la segunda pasada, se decide con la primera.
 *
 * La segunda pasada solo puede endurecer:
 * - "No es una factura" no se repasa: ningún otro modelo la convierte en pagable.
 * - Si el respaldo dice que no es factura, gana esa lectura (escala).
 * - Si las dos pasadas leen distinto un campo crítico, se elige la de menos problemas y
 *   además se registra la discrepancia como ambigüedad, que escala.
 */

export type ReadInvoiceOptions = {
  readonly primaryModel: string;
  readonly fallbackModel: string | null;
  readonly maxOutputTokens: number;
  /** Plazo de cada llamada al modelo. */
  readonly timeoutMs: number;
  /**
   * Plazo de toda la lectura, con reintentos y segunda pasada. Debe quedar por debajo del
   * `maxDuration` de la ruta: si se agota, la lectura termina como ilegible y escala.
   */
  readonly deadlineMs?: number;
};

export type ReadInvoiceResult = {
  readonly record: ExtractionRecord;
  readonly verification: VerificationReport;
  readonly issues: Verification["issues"];
  readonly passes: readonly ReadResult[];
  readonly cost_usd_micros: number;
  readonly latency_ms: number;
};

/** Texto de la capa si la hay, y siempre las páginas renderizadas (el tope de páginas acota el costo). */
async function promptInputFor(doc: IngestedDocument, storage: FileStorage): Promise<PromptInput> {
  const pages = await Promise.all(
    doc.pages.map(async (p) => ({
      bytes: await storage.get(p.pngKey),
      mediaType: p.pngKey.endsWith(".jpg") ? ("image/jpeg" as const) : ("image/png" as const),
    })),
  );
  return { text: doc.has_text_layer ? doc.text : null, pages, channelText: doc.channel_text };
}

function problemsOf(v: Verification): number {
  return v.issues.length + v.report.ambiguities.length + (v.report.totals === "mismatch" ? 1 : 0);
}

/** La lectura con ambigüedades agregadas, sin repetir campo, dentro del tope del esquema. */
function withAmbiguities(record: ExtractionRecord, extra: readonly Ambiguity[]): ExtractionRecord {
  const { extraction } = record;
  if (extra.length === 0 || extraction.kind !== "invoice") return record;
  const known = new Set(extraction.ambiguities.map((a) => a.field));
  const ambiguities = [
    ...extraction.ambiguities,
    ...extra.filter((a) => !known.has(a.field)),
  ].slice(0, 20);
  const merged: Extraction = { ...extraction, ambiguities };
  return { ...record, extraction: merged, extraction_hash: jsonHash(merged) };
}

/** Campos donde una discrepancia entre modelos cambia a quién o cuánto se paga. */
const CRITICAL_FIELDS = [
  "payee_name",
  "total",
  "currency",
  "bank_account",
  "invoice_number",
] as const;

const sameLiteral = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/**
 * Discrepancias entre dos lecturas de factura en campos críticos, como ambigüedades. No lo es
 * la de un campo en que las dos citan el mismo texto del documento y solo uno de los valores
 * sale de esa cita: el documento dice una sola cosa y una lectura la convirtió mal ("8,500.00"
 * leído como 848500), cosa que el Verificador ya demuestra. Si se quedara la lectura
 * equivocada, su propia verificación la escala por la cita que no la respalda.
 */
export function disagreements(a: Extraction, b: Extraction): Ambiguity[] {
  if (a.kind !== "invoice" || b.kind !== "invoice") return [];
  const out: Ambiguity[] = [];
  for (const name of CRITICAL_FIELDS) {
    const fa = a.fields[name];
    const fb = b.fields[name];
    if (!isPresent(fa) || !isPresent(fb)) continue;
    const va = String(fa.value);
    const vb = String(fb.value);
    if (va === vb) continue;
    if (sameLiteral(fa.evidence.literal, fb.evidence.literal)) {
      const aOk = valueDerived(name, fa.value, fa.evidence.literal) === null;
      const bOk = valueDerived(name, fb.value, fb.evidence.literal) === null;
      if (aOk !== bOk) continue;
    }
    out.push({ field: name, candidates: [va, vb] });
  }
  return out;
}

export async function readInvoice(
  deps: ReaderDeps,
  storage: FileStorage,
  doc: IngestedDocument,
  options: ReadInvoiceOptions,
): Promise<ReadInvoiceResult> {
  const deadlineAt = options.deadlineMs === undefined ? undefined : deps.now() + options.deadlineMs;
  const input = { ...(await promptInputFor(doc, storage)), document_hash: doc.document_hash };
  const text = doc.has_text_layer ? doc.text : null;

  const first = await readDocument(deps, input, {
    model: options.primaryModel,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
    fallbackUsed: false,
    deadlineAt,
  });
  let chosen = first;
  let verification = verifyExtraction(first.record.extraction, text);
  const passes: ReadResult[] = [first];

  const firstKind = first.record.extraction.kind;
  const extraAmbiguities: Ambiguity[] = [];
  const wantsSecond =
    firstKind === "unreadable" || (firstKind === "invoice" && needsFallback(verification));
  const timeLeft = remainingMs(deadlineAt, deps.now()) >= MIN_ATTEMPT_MS;
  if (options.fallbackModel !== null && wantsSecond && timeLeft) {
    const second = await readDocument(deps, input, {
      model: options.fallbackModel,
      maxOutputTokens: options.maxOutputTokens,
      timeoutMs: options.timeoutMs,
      fallbackUsed: true,
      deadlineAt,
    });
    passes.push(second);
    const secondVerification = verifyExtraction(second.record.extraction, text);
    const secondKind = second.record.extraction.kind;
    const takeSecond =
      // Ilegible no aporta nada: cualquier lectura del respaldo es mejor.
      (firstKind === "unreadable" && secondKind !== "unreadable") ||
      // "No es factura" del respaldo endurece: escala.
      (firstKind === "invoice" && secondKind === "not_invoice") ||
      // Dos facturas: la de menos problemas; en empate, la primera.
      (firstKind === "invoice" &&
        secondKind === "invoice" &&
        problemsOf(secondVerification) < problemsOf(verification));
    extraAmbiguities.push(...disagreements(first.record.extraction, second.record.extraction));
    if (takeSecond) {
      chosen = second;
      verification = secondVerification;
    }
  }

  const detected: Suspicion[] = detectAll({ document: doc.text, channel: doc.channel_text });
  if (passes.some((p) => p.canary_detected)) {
    detected.push({
      kind: "canary",
      quote: "el identificador interno del prompt apareció en la salida del modelo",
    });
  }

  return {
    // Los desacuerdos entre pasadas quedan en la lectura guardada, junto a las ambigüedades del
    // modelo: así los ve toda reevaluación posterior, y se van solo cuando una persona fija el
    // campo (la corrección descarta la ambigüedad del campo que cambia).
    record: withAmbiguities(chosen.record, extraAmbiguities),
    verification: {
      ...verification.report,
      ambiguities: verification.report.ambiguities,
      suspicions: [...verification.report.suspicions, ...detected],
    },
    issues: verification.issues,
    passes,
    cost_usd_micros: passes.reduce((acc, p) => acc + p.cost_usd_micros, 0),
    latency_ms: passes.reduce((acc, p) => acc + p.latency_ms, 0),
  };
}
