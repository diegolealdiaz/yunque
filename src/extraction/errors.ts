/** Errores tipados de ingesta y lectura: código, si es recuperable y la acción sugerida. */

export type IngestErrorCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "too_many_pages"
  | "corrupt_document"
  | "invalid_channel_payload";

export class IngestError extends Error {
  readonly code: IngestErrorCode;
  readonly recoverable: boolean;
  readonly action: string;

  constructor(code: IngestErrorCode, message: string, action: string, recoverable = false) {
    super(message);
    this.name = "IngestError";
    this.code = code;
    this.recoverable = recoverable;
    this.action = action;
  }
}
