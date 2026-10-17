/**
 * Extracción: ingesta, Lector (modelo), Verificador (código), Detector y orquestación.
 * Solo `model.ts` importa el SDK del modelo; aquí solo `ingest.ts` toca PDFium (el dataset usa el suyo en `src/dataset/render.ts`).
 */
export * from "./detector";
export * from "./errors";
export * from "./ingest";
export * from "./model";
export * from "./prices";
export * from "./prompt";
export * from "./read-invoice";
export * from "./reader";
export * from "./sniff";
export * from "./storage";
export * from "./verify";
export * from "./words";
