import "./env";

import { generateDataset, loadDatasetSources, writeDataset } from "@/src/dataset";
import { writeGalleryPreviews, writeHistoryDocuments } from "@/src/dataset/history-documents";

/** Regenera `data/dataset/generado` desde el manifiesto y las plantillas. */
async function main(): Promise<void> {
  const sources = await loadDatasetSources();
  const result = await generateDataset(sources);
  const out = await writeDataset(result);
  const documents = await writeHistoryDocuments(result, sources);
  const previews = await writeGalleryPreviews(result);
  console.warn(
    `Dataset generado en ${out}: ${String(result.truth.cases.length)} casos, ${String(result.files.size)} archivos, ${String(documents.length)} facturas del historial con sus páginas, ${String(previews)} miniaturas de la galería`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
