import type {
  Ambiguity,
  Balance,
  ExtractedFieldName,
  Extraction,
  FxTable,
  LedgerPeriod,
  Money,
  Policy,
  Sha256,
  Suspicion,
  Vendor,
  Verdict,
} from "@/src/domain";

/**
 * Entrada del Juez. Todo lo que una regla necesita viene aquí; nada se lee de fuera.
 * El motor es puro: sin red, sin base, sin reloj implícito. La fecha entra como `now`.
 */

/** Resultado del Resolutor: con quién se empareja el beneficiario leído. */
export type PayeeMatch =
  | { readonly kind: "matched"; readonly vendor: Vendor; readonly by: "exact" | "alias" | "tax_id" }
  | {
      readonly kind: "unknown";
      /** Vendor más parecido, si lo hay, para la explicación. No habilita el pago. */
      readonly closest: { readonly vendor: Vendor; readonly similarity: number } | null;
    };

/** Resultado del Verificador (código) sobre la extracción. */
export type VerificationReport = {
  /**
   * Campos cuya evidencia no se sostiene: la cita no aparece en el texto del documento, o
   * aparece pero el valor leído no se deriva de ella. El detalle de cada caso queda en el
   * informe del Verificador; para el Juez ambos significan "no hay evidencia válida".
   */
  readonly evidence_missing: readonly ExtractedFieldName[];
  /** Si subtotal e impuestos existen, si cuadran con el total. */
  readonly totals: "ok" | "mismatch" | "not_applicable";
  /** Ambigüedades confirmadas por código (dos totales, dos cuentas, monto en letras distinto). */
  readonly ambiguities: readonly Ambiguity[];
  /** Señales de inyección confirmadas por el Detector de código. */
  readonly suspicions: readonly Suspicion[];
};

/** Lo que se sabe de una factura anterior de la misma empresa, para duplicados e historial. */
export type PriorInvoice = {
  readonly invoice_id: string;
  /** Referencia legible (YQ-2026-10-0001), para nombrarla ante una persona. */
  readonly reference: string | null;
  readonly vendor_id: string | null;
  readonly document_hash: Sha256;
  readonly semantic_key: string | null;
  readonly amount: Money | null;
  readonly received_at: string;
  /**
   * Resultado conocido: veredicto del agente o resolución humana. `simulada` es un `pagar`
   * decidido en modo de prueba: cuenta para duplicados, pero nunca como pago hecho.
   */
  readonly outcome: Verdict | "simulada" | "aprobada" | "rechazada" | "pendiente";
};

export type EvaluationContext = {
  readonly extraction: Extraction;
  readonly verification: VerificationReport;
  readonly payee: PayeeMatch;
  readonly policy: Policy;
  readonly fx: FxTable;
  /** Periodo de presupuesto vigente en USD, o null si no existe (artefacto ausente). */
  readonly ledger: LedgerPeriod | null;
  readonly balances: readonly Balance[];
  /** Facturas previas relevantes: mismo vendor, misma llave semántica o mismo documento. */
  readonly prior: readonly PriorInvoice[];
  /** Id de la factura que se evalúa, para excluirla de su propio historial. */
  readonly invoice_id: string;
  /** Hash del documento que se evalúa; un previo con el mismo hash es el mismo archivo. */
  readonly document_hash: Sha256;
  /** Llave semántica de la factura actual, calculada por el caso de uso tras la lectura. */
  readonly semantic_key: string | null;
  /**
   * "Ahora" para ventanas y fechas. Los días se cuentan en UTC, así que el caso de uso debe
   * pasar la medianoche UTC del día de negocio (America/Bogota), no el instante real.
   */
  readonly now: Date;
};

/** Verdadero si la factura anterior terminó en pago real (no simulado). */
export function wasPaid(prior: PriorInvoice): boolean {
  return prior.outcome === "pagar" || prior.outcome === "aprobada";
}
