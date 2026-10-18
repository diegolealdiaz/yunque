import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { documentHash, jsonHash } from "@/src/domain";

import { historyCase } from "./history";
import { renderPdf, renderScan, type PaintedField } from "./render";
import {
  GroundTruthSchema,
  HistorySchema,
  ManifestSchema,
  TemplateSchema,
  type DatasetCase,
  type DocumentTemplate,
  type GroundTruth,
  type HistoryEntry,
  type Manifest,
} from "./schema";

/**
 * Generador del dataset. Lee `manifiesto.json` y `plantillas/*.json`, produce los archivos
 * en `generado/` y escribe `verdad.json` con la verdad esperada y las coordenadas por campo.
 * También pinta cada factura del historial (`generado/historial/`), para que se vea como las
 * del lote. Determinista: el mismo manifiesto produce los mismos bytes.
 */

export const DATASET_DIR = path.join(process.cwd(), "data", "dataset");
export const OUTPUT_DIR_NAME = "generado";
/** Carpeta de las facturas del historial dentro de `generado/`. */
export const HISTORY_DIR_NAME = "historial";

export type DatasetSources = {
  readonly manifest: Manifest;
  readonly manifestHash: string;
  readonly templates: ReadonlyMap<DocumentTemplate["id"], DocumentTemplate>;
  readonly templatesHash: string;
  readonly history: readonly HistoryEntry[];
  readonly historyHash: string;
};

/** Lee y valida manifiesto, plantillas e historial. */
export async function loadDatasetSources(dir: string = DATASET_DIR): Promise<DatasetSources> {
  const manifestText = await readFile(path.join(dir, "manifiesto.json"), "utf8");
  const manifest = ManifestSchema.parse(JSON.parse(manifestText));
  const templateDir = path.join(dir, "plantillas");
  const names = (await readdir(templateDir)).filter((n) => n.endsWith(".json")).sort();
  const templates = new Map<DocumentTemplate["id"], DocumentTemplate>();
  const parsedTemplates: unknown[] = [];
  for (const name of names) {
    const text = await readFile(path.join(templateDir, name), "utf8");
    const template = TemplateSchema.parse(JSON.parse(text));
    parsedTemplates.push(template);
    if (templates.has(template.id)) throw new Error(`Plantilla repetida: ${template.id}`);
    templates.set(template.id, template);
  }
  for (const c of manifest.cases) {
    if (!templates.has(c.template))
      throw new Error(`El caso ${c.id} usa la plantilla inexistente ${c.template}`);
  }
  const historyText = await readFile(path.join(dir, "historial.json"), "utf8");
  const history = HistorySchema.parse(JSON.parse(historyText));
  // Hashes sobre el JSON canónico: el formato del archivo no cambia la identidad del dataset.
  return {
    manifest,
    manifestHash: jsonHash(manifest),
    templates,
    templatesHash: jsonHash(parsedTemplates),
    history,
    historyHash: jsonHash(history),
  };
}

/** Correo simulado: metadatos más el adjunto embebido, para que el archivo sea autocontenido. */
export const EmailFileSchema = z.strictObject({
  kind: z.literal("email"),
  from: z.string(),
  sent_at: z.iso.datetime(),
  subject: z.string().nullable(),
  body: z.string(),
  attachment: z.strictObject({
    filename: z.string(),
    content_type: z.literal("application/pdf"),
    data_base64: z.string(),
  }),
});
export type EmailFile = z.infer<typeof EmailFileSchema>;

/** Mensaje de chat simulado con adjunto. */
export const ChatFileSchema = z.strictObject({
  kind: z.literal("chat"),
  from: z.string(),
  sent_at: z.iso.datetime(),
  text: z.string(),
  attachment: EmailFileSchema.shape.attachment,
});
export type ChatFile = z.infer<typeof ChatFileSchema>;

type Generated = {
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly baseFile: string | null;
  readonly fields: PaintedField[];
};

async function generateCase(
  c: DatasetCase,
  sources: DatasetSources,
  pdfCache: Map<string, { bytes: Uint8Array; fields: PaintedField[]; file: string }>,
): Promise<Generated> {
  const template = sources.templates.get(c.template);
  if (!template) throw new Error(`Plantilla ${c.template} no cargada`);

  const baseId = c.same_document_as ?? c.id;
  let base = pdfCache.get(baseId);
  if (!base) {
    const baseCase = sources.manifest.cases.find((x) => x.id === baseId);
    if (!baseCase) throw new Error(`Caso base ${baseId} no existe`);
    const baseTemplate = sources.templates.get(baseCase.template);
    if (!baseTemplate) throw new Error(`Plantilla ${baseCase.template} no cargada`);
    const rendered = await renderPdf(baseTemplate, baseCase.document);
    base = { ...rendered, file: `${baseId}.pdf` };
    pdfCache.set(baseId, base);
  }

  switch (c.format) {
    case "pdf":
    case "not_invoice":
      return {
        file: `${c.id}.pdf`,
        bytes: base.bytes,
        baseFile: c.same_document_as ? base.file : null,
        fields: base.fields,
      };
    case "png": {
      const png = await renderScan(base.bytes);
      return { file: `${c.id}.png`, bytes: png, baseFile: base.file, fields: base.fields };
    }
    case "email": {
      if (!c.channel) throw new Error(`El caso ${c.id} no tiene canal`);
      const email: EmailFile = {
        kind: "email",
        from: c.channel.from,
        sent_at: c.channel.sent_at,
        subject: c.channel.subject,
        body: c.channel.body,
        attachment: {
          filename: base.file,
          content_type: "application/pdf",
          data_base64: Buffer.from(base.bytes).toString("base64"),
        },
      };
      return {
        file: `${c.id}.email.json`,
        bytes: new TextEncoder().encode(`${JSON.stringify(email, null, 2)}\n`),
        baseFile: base.file,
        fields: base.fields,
      };
    }
    case "chat": {
      if (!c.channel) throw new Error(`El caso ${c.id} no tiene canal`);
      const chat: ChatFile = {
        kind: "chat",
        from: c.channel.from,
        sent_at: c.channel.sent_at,
        text: c.channel.body,
        attachment: {
          filename: base.file,
          content_type: "application/pdf",
          data_base64: Buffer.from(base.bytes).toString("base64"),
        },
      };
      return {
        file: `${c.id}.chat.json`,
        bytes: new TextEncoder().encode(`${JSON.stringify(chat, null, 2)}\n`),
        baseFile: base.file,
        fields: base.fields,
      };
    }
  }
}

export type GenerationResult = {
  readonly truth: GroundTruth;
  readonly files: ReadonlyMap<string, Uint8Array>;
};

/** Genera todos los casos en memoria. */
export async function generateDataset(sources: DatasetSources): Promise<GenerationResult> {
  const pdfCache = new Map<string, { bytes: Uint8Array; fields: PaintedField[]; file: string }>();
  const files = new Map<string, Uint8Array>();
  const cases: GroundTruth["cases"] = [];
  for (const c of sources.manifest.cases) {
    const out = await generateCase(c, sources, pdfCache);
    files.set(out.file, out.bytes);
    if (out.baseFile && !files.has(out.baseFile)) {
      const base = pdfCache.get(c.same_document_as ?? c.id);
      if (base) files.set(out.baseFile, base.bytes);
    }
    cases.push({
      id: c.id,
      group: c.group,
      format: c.format,
      file: out.file,
      document_hash: documentHash(out.bytes),
      base_file: out.baseFile,
      expected: c.expected,
      fields: out.fields,
    });
  }
  const history: GroundTruth["history"] = [];
  for (const [index, entry] of sources.history.entries()) {
    const c = historyCase(entry, index, sources.manifest);
    const template = sources.templates.get(c.template);
    if (!template) throw new Error(`Plantilla ${c.template} no cargada`);
    const { bytes } = await renderPdf(template, c.document);
    const file = `${HISTORY_DIR_NAME}/${c.id}.pdf`;
    files.set(file, bytes);
    history.push({
      id: c.id,
      invoice_number: entry.invoice_number,
      file,
      document_hash: documentHash(bytes),
    });
  }
  const truth = GroundTruthSchema.parse({
    generated_with: {
      manifest_hash: sources.manifestHash,
      templates_hash: sources.templatesHash,
      history_hash: sources.historyHash,
    },
    today: sources.manifest.today,
    cases,
    history,
  });
  return { truth, files };
}

/** Escribe el resultado en `generado/`, borrando lo anterior. */
export async function writeDataset(
  result: GenerationResult,
  dir: string = DATASET_DIR,
): Promise<string> {
  const out = path.join(dir, OUTPUT_DIR_NAME);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const [name, bytes] of [...result.files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    await mkdir(path.dirname(path.join(out, name)), { recursive: true });
    await writeFile(path.join(out, name), bytes);
  }
  await writeFile(path.join(out, "verdad.json"), `${JSON.stringify(result.truth, null, 2)}\n`);
  return out;
}

/** Lee la verdad esperada ya generada. */
export async function loadGroundTruth(dir: string = DATASET_DIR): Promise<GroundTruth> {
  const text = await readFile(path.join(dir, OUTPUT_DIR_NAME, "verdad.json"), "utf8");
  return GroundTruthSchema.parse(JSON.parse(text));
}
