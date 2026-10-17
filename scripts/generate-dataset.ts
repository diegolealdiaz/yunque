import "./env";

import { generateDataset, loadDatasetSources, writeDataset } from "@/src/dataset";

/** Regenera `data/dataset/generado` desde el manifiesto y las plantillas. */
async function main(): Promise<void> {
  const sources = await loadDatasetSources();
  const result = await generateDataset(sources);
  const out = await writeDataset(result);
  console.warn(
    `Dataset generado en ${out}: ${String(result.truth.cases.length)} casos, ${String(result.files.size)} archivos`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
