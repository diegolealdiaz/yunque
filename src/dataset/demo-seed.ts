import { readFile } from "node:fs/promises";
import path from "node:path";

import { HistorySchema, ManifestSchema, type HistoryEntry } from "./schema";

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
