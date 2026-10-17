import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FindingCodeSchema, type Finding } from "@/src/domain";
import { evaluate } from "@/src/engine";
import {
  TEMPLATES,
  checklistFor,
  explainDecision,
  explainFinding,
  sanitizeDocumentText,
} from "@/src/explain";

import { baseContext, baseExtraction, missing, present } from "../engine/fixtures";

const BELL = String.fromCharCode(0x0007);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

function finding(code: Finding["code"], observed = "OBS-123", threshold = "UMB-456"): Finding {
  return {
    code,
    severity: "block",
    action: "escalar",
    observed,
    threshold,
    evidence: null,
    field: "total",
    message: "m",
  };
}

describe("explicador (P-34)", () => {
  it("toda regla del catálogo tiene plantilla, y la plantilla cita valor observado y umbral", () => {
    for (const code of FindingCodeSchema.options) {
      expect(code in TEMPLATES, code).toBe(true);
      const text = explainFinding(finding(code));
      expect(text, code).toContain("OBS-123");
      expect(text, code).toContain("UMB-456");
      expect(text.endsWith("."), code).toBe(true);
    }
  });

  it("explica un pago sin hallazgos y un escalado con sus motivos", () => {
    const paid = evaluate(baseContext());
    const text = explainDecision({
      evaluation: paid,
      amount: { amount: 480_000_000, currency: "COP" },
      payeeName: "Nube Andina SAS",
      policyVersion: 4,
    });
    expect(text).toContain("Se paga 4.800.000 COP a «Nube Andina SAS».");
    expect(text).toContain("política v4");
    expect(text).toContain("Pago programado para el 2026-10-22.");

    const escalated = evaluate(baseContext({ prior: [] }));
    const why = explainDecision({
      evaluation: escalated,
      amount: { amount: 480_000_000, currency: "COP" },
      payeeName: "Nube Andina SAS",
      policyVersion: 4,
    });
    expect(why).toContain("Se escala a una persona 4.800.000 COP");
    expect(why).toContain("- first_payment_to_vendor:");
    expect(why).toContain("sin pagos previos");
    expect(why).toContain("Queda en pendientes");
  });

  it("el checklist sale de los hallazgos, sin repetidos y con el punto general al final", () => {
    const items = checklistFor([
      finding("first_payment_to_vendor"),
      finding("first_payment_to_vendor"),
      finding("amount_over_hard_limit"),
      finding("amount_over_approval_threshold", "1,250.00 USD"),
    ]);
    expect(items.map((i) => i.code)).toEqual([
      "first_payment_to_vendor",
      "amount_over_approval_threshold",
      "general",
    ]);
    expect(items[1]?.text).toContain("1,250.00 USD");
    expect(items.every((i) => !i.checked)).toBe(true);
  });
});

describe("escape de contenido del documento (P-35)", () => {
  it("neutraliza etiquetas, markdown, enlaces, correos, control e invisibles", () => {
    const hostile = `<script>alert(1)</script> **negrita** [x](https://evil.example) \`code\` _u_ a@b.co ${BELL} ${ZERO_WIDTH_SPACE}x${LINE_SEPARATOR}y`;
    const out = sanitizeDocumentText(hostile);
    expect(out).not.toMatch(/[<>`*_[\]]/);
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toMatch(/\w@\w/);
    expect(out).not.toMatch(/\p{Cc}|\p{Cf}/u);
    expect(out).toContain("‹script›");
    expect(out).toContain("x y");
  });

  it("acota la longitud y colapsa espacios", () => {
    const out = sanitizeDocumentText(`${"a".repeat(1000)}   b\n\n c`);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(sanitizeDocumentText("a   b\n\nc")).toBe("a b c");
  });

  it("propiedad: ninguna explicación contiene etiquetas ni enlaces, venga lo que venga del documento", () => {
    const arbText = fc.string({ minLength: 1, maxLength: 80 }).filter((t) => t.trim().length > 0);
    fc.assert(
      fc.property(arbText, arbText, (payee, number) => {
        const ctx = baseContext({
          payee: { kind: "unknown", closest: null },
          extraction: baseExtraction({
            payee_name: present(payee, payee),
            invoice_number: present(number, number),
            subtotal: missing(),
            taxes: missing(),
          }),
        });
        const text = explainDecision({
          evaluation: evaluate(ctx),
          amount: { amount: 1, currency: "USD" },
          payeeName: payee,
          policyVersion: 1,
        });
        expect(text).not.toMatch(/<[a-zA-Z/!]/);
        expect(text).not.toMatch(/https?:\/\//);
        expect(text).not.toMatch(/\[[^\]]*\]\(/);
      }),
      { numRuns: 300 },
    );
  });
});
