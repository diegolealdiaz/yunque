import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Channel } from "@/src/domain";

import {
  GroundTruthSchema,
  HistorySchema,
  ManifestSchema,
  type DatasetCase,
  type HistoryEntry,
} from "./schema";

/**
 * Lo que necesita la copia de la demo de cada visitante: el historial de meses anteriores,
 * lo ya comprometido del mes y el día del dataset. Liviano a propósito: no carga plantillas
 * ni el generador de PDF, así el servidor web no arrastra esas dependencias.
 */

export type DemoSeed = {
  readonly today: string;
  readonly committedUsdCents: number;
  readonly history: readonly HistoryEntry[];
};

export async function loadDemoSeed(
  dir: string = path.join(process.cwd(), "data", "dataset"),
): Promise<DemoSeed> {
  const [manifestText, historyText] = await Promise.all([
    readFile(path.join(dir, "manifiesto.json"), "utf8"),
    readFile(path.join(dir, "historial.json"), "utf8"),
  ]);
  const manifest = ManifestSchema.parse(JSON.parse(manifestText));
  return {
    today: manifest.today,
    committedUsdCents: manifest.october_committed_usd_cents,
    history: HistorySchema.parse(JSON.parse(historyText)),
  };
}

/** Un caso del lote del periodo: su id, su archivo generado y su formato. */
export type BatchCase = {
  readonly id: string;
  readonly file: string;
  readonly format: "pdf" | "png" | "email" | "chat" | "not_invoice";
};

/** El canal con el que llega cada formato del dataset: el correo por la bandeja, el chat por Telegram. */
export function channelOfFormat(format: BatchCase["format"]): Channel {
  if (format === "email") return "inbox";
  if (format === "chat") return "telegram";
  return "batch";
}

export const GENERATED_DIR = path.join(process.cwd(), "data", "dataset", "generado");

/**
 * Casos del lote en el orden del dataset, leídos de `verdad.json`. Es la lista cerrada de lo
 * que "Procesar periodo" puede pedir: el cliente nombra un caso, nunca una ruta.
 */
export async function loadBatchCases(dir: string = GENERATED_DIR): Promise<BatchCase[]> {
  const truth = GroundTruthSchema.parse(
    JSON.parse(await readFile(path.join(dir, "verdad.json"), "utf8")),
  );
  return truth.cases.map((c) => ({ id: c.id, file: c.file, format: c.format }));
}

/**
 * Casos del manifiesto con su veredicto esperado y los campos del documento: la verdad contra
 * la que Métricas compara lo que decidió el agente con cada caso del lote.
 */
export async function loadExpectedCases(
  dir: string = path.join(process.cwd(), "data", "dataset"),
): Promise<DatasetCase[]> {
  const manifest = ManifestSchema.parse(
    JSON.parse(await readFile(path.join(dir, "manifiesto.json"), "utf8")),
  );
  return manifest.cases;
}
