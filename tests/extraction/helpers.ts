import { readFile } from "node:fs/promises";
import path from "node:path";

import { fieldLiteral, formatAmount, type DatasetCase, type DocumentTemplate } from "@/src/dataset";
import { loadSeedData } from "@/src/db/seed";
import type { Evidence, Extraction, ExtractionRecord, Vendor } from "@/src/domain";
import type {
  ExtractionCache,
  LlmCallLog,
  ModelClient,
  ModelRequest,
  ReaderDeps,
} from "@/src/extraction";

/** Vendors de la semilla como objetos del dominio, con ids ficticios estables. */
export async function seedVendors(): Promise<Map<string, Vendor>> {
  const seed = await loadSeedData();
  const out = new Map<string, Vendor>();
  seed.vendors.forEach((v, i) => {
    out.set(v.key, {
      id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(i).padStart(2, "0")}`,
      organization_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      name: v.name,
      aliases: v.aliases,
      ...(v.tax_id === undefined ? {} : { tax_id: v.tax_id }),
      country: v.country,
      account: v.account,
      verification: v.verification,
      agreement: v.agreement,
      created_at: "2026-08-01T00:00:00.000Z",
    });
  });
  return out;
}

export const GENERATED_DIR = path.join(process.cwd(), "data", "dataset", "generado");

export async function generatedFile(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(GENERATED_DIR, name)));
}

/** Extracción "perfecta" de un caso del manifiesto, como la daría un Lector ideal. */
export function idealExtraction(c: DatasetCase, template: DocumentTemplate): Extraction {
  const doc = c.document;
  const ev = (literal: string): Evidence => ({ literal, quote: literal, page: 1 });
  const present = <T>(value: T, literal: string) => ({
    value,
    evidence: ev(literal),
    confidence: 0.96,
    source: "modelo" as const,
  });
  const missing = { value: null, reason: "no aparece en el documento" };
  const lit = (name: Parameters<typeof fieldLiteral>[1]) =>
    fieldLiteral(doc, name, template.locale);
  const amountField = (value: number | null) =>
    value === null ? missing : present(value, formatAmount(value, template.locale));
  return {
    kind: "invoice",
    language: template.locale.startsWith("en")
      ? "en"
      : template.locale.startsWith("de")
        ? "de"
        : "es",
    fields: {
      payee_name: present(doc.payee_name, doc.payee_name),
      payee_tax_id:
        doc.payee_tax_id === null ? missing : present(doc.payee_tax_id, doc.payee_tax_id),
      invoice_number: present(doc.invoice_number, doc.invoice_number),
      issue_date: present(doc.issue_date, lit("issue_date") ?? ""),
      due_date: doc.due_date === null ? missing : present(doc.due_date, lit("due_date") ?? ""),
      currency: present(doc.currency, doc.currency),
      subtotal: amountField(doc.subtotal),
      taxes: amountField(doc.taxes),
      total: present(doc.total, formatAmount(doc.total, template.locale)),
      bank_account:
        doc.bank_account === null ? missing : present(doc.bank_account, doc.bank_account),
      bank_holder: doc.bank_holder === null ? missing : present(doc.bank_holder, doc.bank_holder),
      hours: doc.hours === null ? missing : present(doc.hours, String(doc.hours)),
      purchase_order:
        doc.purchase_order === null ? missing : present(doc.purchase_order, doc.purchase_order),
      description: present(doc.description, doc.description),
    },
    ambiguities: [],
    suspicions: [],
  };
}

/** Cliente simulado: devuelve respuestas en orden y registra cada petición. */
export function fakeClient(
  responses: readonly (string | Error)[],
): ModelClient & { requests: ModelRequest[] } {
  const queue = [...responses];
  const requests: ModelRequest[] = [];
  return {
    requests,
    complete(request) {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) return Promise.reject(new Error("sin respuestas simuladas"));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ text: next, inputTokens: 1000, outputTokens: 200 });
    },
  };
}

export function memoryCache(): ExtractionCache & { store: Map<string, ExtractionRecord> } {
  const store = new Map<string, ExtractionRecord>();
  const keyOf = (k: Parameters<ExtractionCache["get"]>[0]) =>
    `${k.document_hash}|${k.prompt_version}|${String(k.schema_version)}|${k.model}|${k.prompt_hash}`;
  return {
    store,
    get: (k) => Promise.resolve(store.get(keyOf(k)) ?? null),
    put: (k, r) => {
      store.set(keyOf(k), r);
      return Promise.resolve();
    },
  };
}

export function readerDeps(
  client: ModelClient,
  cache = memoryCache(),
): ReaderDeps & { calls: LlmCallLog[] } {
  const calls: LlmCallLog[] = [];
  let tick = 0;
  return {
    client,
    cache,
    calls,
    logCall: (c) => {
      calls.push(c);
      return Promise.resolve();
    },
    now: () => (tick += 50),
    canary: "YQ-canario-de-prueba-0001",
  };
}
