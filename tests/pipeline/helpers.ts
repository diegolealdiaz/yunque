import { loadDatasetSources, loadGroundTruth, type DatasetCase } from "@/src/dataset";
import { loadSeedData, seedDatasetOrganization } from "@/src/db/seed";
import type { Extraction, PolicyVersion, ReceiptKey } from "@/src/domain";
import { MemoryFileStorage, type ModelClient, type ModelRequest } from "@/src/extraction";
import {
  createModelReader,
  type InvoiceReader,
  type ProcessInvoiceDeps,
  type ProcessInvoiceInput,
} from "@/src/usecases";

import { openTestDatabase, type TestDatabase } from "../db/helpers";
import { generatedFile, idealExtraction } from "../extraction/helpers";

/**
 * Banco de pruebas del caso de uso: base temporal sembrada como el dataset (empresa,
 * vendors, política, historial y presupuesto comprometido), almacenamiento en memoria y un
 * modelo simulado detrás del Lector real, así corren de verdad la caché, el registro de
 * llamadas, el Verificador y el Detector.
 */

export const LIMITS = { maxUploadBytes: 5 * 1024 * 1024, maxPages: 5 } as const;
export const MODELS = {
  primary: "anthropic/claude-haiku-5.5",
  fallback: "anthropic/claude-sonnet-5.5",
} as const;

/**
 * Modelo simulado. Si algún texto de la petición contiene una llave de `routes`, responde
 * lo de esa ruta (sirve para procesar varios documentos a la vez); si no, responde `next`.
 * Registra cada petición.
 */
export type ScriptedClient = ModelClient & {
  next: string | Error | null;
  readonly routes: Map<string, string>;
  readonly requests: ModelRequest[];
};

export function scriptedClient(): ScriptedClient {
  const client: ScriptedClient = {
    next: null,
    routes: new Map(),
    requests: [],
    complete(request) {
      client.requests.push(request);
      const texts = request.parts.flatMap((part) => (part.type === "text" ? [part.text] : []));
      const routed = [...client.routes].find(([key]) => texts.some((t) => t.includes(key)));
      const next = routed ? routed[1] : client.next;
      if (next === null) return Promise.reject(new Error("sin respuesta simulada"));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ text: next, inputTokens: 1200, outputTokens: 300 });
    },
  };
  return client;
}

export type Pipeline = {
  readonly t: TestDatabase;
  readonly organizationId: string;
  readonly policyVersion: PolicyVersion;
  readonly storage: MemoryFileStorage;
  readonly client: ScriptedClient;
  readonly deps: ProcessInvoiceDeps;
  /** Entrada lista para procesar unos bytes con una llave de recepción. */
  input(bytes: Uint8Array, receiptKey: ReceiptKey, name?: string): ProcessInvoiceInput;
  close(): Promise<void>;
};

export async function openPipeline(
  overrides: { reader?: InvoiceReader | null } = {},
): Promise<Pipeline> {
  const t = await openTestDatabase();
  const [data, dataset] = await Promise.all([loadSeedData(), loadDatasetSources()]);
  const seeded = await seedDatasetOrganization(t.db, {
    data,
    newId: t.newId,
    now: t.now,
    systemHardCapUsdCents: 10_000_000,
    visitorId: null,
    history: dataset.history,
    committedUsdCents: dataset.manifest.october_committed_usd_cents,
    today: dataset.manifest.today,
  });
  const storage = new MemoryFileStorage();
  const client = scriptedClient();
  const reader =
    overrides.reader === undefined
      ? createModelReader({
          db: t.db,
          storage,
          client,
          primaryModel: MODELS.primary,
          fallbackModel: MODELS.fallback,
          maxOutputTokens: 1500,
          cacheScope: (organizationId) => organizationId,
          newId: t.newId,
          now: t.now,
        })
      : overrides.reader;
  const organizationId = seeded.organization.id;
  return {
    t,
    organizationId,
    policyVersion: seeded.policyVersion,
    storage,
    client,
    deps: {
      db: t.db,
      storage,
      reader,
      limits: LIMITS,
      newId: t.newId,
      now: t.now,
      timeZone: "America/Bogota",
      businessDate: dataset.manifest.today,
    },
    input: (bytes, receiptKey, name = "factura.pdf") => ({
      organizationId,
      channel: "upload",
      receiptKey,
      bytes,
      originalName: name,
    }),
    close: () => t.close(),
  };
}

export type CaseFixture = {
  readonly case: DatasetCase;
  /** Archivo tal como se entrega: PDF, PNG escaneado, correo o chat en JSON. */
  readonly bytes: Uint8Array;
  readonly fileName: string;
  /** Lo que respondería un Lector ideal para este caso, en JSON. */
  readonly modelOutput: string;
};

/** Casos del manifiesto en orden, con su archivo generado y la respuesta ideal del modelo. */
export async function datasetCases(): Promise<CaseFixture[]> {
  const [src, truth] = await Promise.all([loadDatasetSources(), loadGroundTruth()]);
  const out: CaseFixture[] = [];
  for (const c of src.manifest.cases) {
    const template = src.templates.get(c.template);
    const generated = truth.cases.find((g) => g.id === c.id);
    if (!template || !generated) throw new Error(`caso ${c.id} incompleto`);
    const extraction: Extraction =
      c.format === "not_invoice"
        ? { kind: "not_invoice", reason: "comprobante de nómina, no una factura", suspicions: [] }
        : idealExtraction(c, template);
    out.push({
      case: c,
      bytes: await generatedFile(generated.file),
      fileName: generated.file,
      modelOutput: JSON.stringify(extraction),
    });
  }
  return out;
}

/** Un caso del manifiesto por id. */
export async function datasetCase(id: string): Promise<CaseFixture> {
  const found = (await datasetCases()).find((c) => c.case.id === id);
  if (!found) throw new Error(`caso ${id} ausente`);
  return found;
}
