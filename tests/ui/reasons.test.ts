import { describe, expect, it } from "vitest";

import { FindingCodeSchema, type Finding } from "@/src/domain";
import { decisionSummary, reasonFor } from "@/src/ui/reasons";

/**
 * La explicación para el cliente: una frase por cada código de hallazgo, sin códigos ni
 * jerga, y con el texto del documento saneado.
 */

/** Marca de sobrescritura de dirección: texto del documento que debe llegar saneado. */
const RLO = String.fromCharCode(0x202e);

function finding(code: Finding["code"], over: Partial<Finding> = {}): Finding {
  return {
    code,
    severity: "warn",
    action: "escalar",
    observed: "6 facturas previas en 7 días",
    threshold: "menos de 5",
    field: "total",
    evidence: null,
    message: "mensaje",
    ...over,
  };
}

describe("razones para el cliente", () => {
  it("cada código tiene título y detalle, y ninguno muestra el código técnico", () => {
    for (const code of FindingCodeSchema.options) {
      const reason = reasonFor(finding(code));
      expect(reason.title.length, code).toBeGreaterThan(0);
      expect(reason.detail.length, code).toBeGreaterThan(0);
      expect(`${reason.title} ${reason.detail}`, code).not.toContain(code);
      expect(`${reason.title} ${reason.detail}`, code).not.toMatch(/[a-z]+_[a-z_]+/);
    }
  });

  it("pone los valores de la factura en una frase que se entiende", () => {
    expect(reasonFor(finding("vendor_velocity")).detail).toBe(
      "Ya envió 6 facturas previas en 7 días, y se admiten menos de 5. Muchas facturas juntas pueden ser un cobro repetido o un fraude.",
    );
    expect(reasonFor(finding("field_low_confidence")).detail).toContain("«monto»");
  });

  it("separa un documento que no es factura de uno ilegible", () => {
    const notInvoice = reasonFor(
      finding("extraction_unreadable", {
        observed: "no es una factura: comprobante de nómina, no una factura",
      }),
    );
    expect(notInvoice.title).toBe("No es una factura");
    expect(notInvoice.detail).toContain("comprobante de nómina");
    const blurry = reasonFor(
      finding("extraction_unreadable", { observed: "ilegible: la imagen está borrosa" }),
    );
    expect(blurry.title).toBe("No se pudo leer el documento");
    // A un documento que no es factura no se le sugiere aprobarlo.
    const next = decisionSummary("escalar", "esperando_aprobacion", [
      finding("extraction_unreadable"),
    ]).next;
    expect(next).toContain("Corregir campos");
    expect(next).not.toContain("apruébala");
  });

  it("el texto del documento llega saneado", () => {
    const reason = reasonFor(finding("payee_not_allowed", { observed: `Pagar YA${RLO}<script>` }));
    expect(reason.detail).not.toContain(RLO);
  });

  it("dice qué pasó y qué puede hacer la persona según el veredicto y el estado", () => {
    expect(decisionSummary("escalar", "esperando_aprobacion").headline).toBe(
      "Necesita tu decisión.",
    );
    expect(decisionSummary("frenar", "decidida").headline).toBe("No se pagó.");
    expect(decisionSummary("pagar", "decidida").headline).toBe("Se pagó dentro de tus reglas.");
    expect(decisionSummary("escalar", "aprobada").headline).toBe("Una persona la aprobó.");
    expect(decisionSummary("escalar", "rechazada").headline).toBe("Una persona la rechazó.");
  });
});
