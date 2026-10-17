import { describe, expect, it } from "vitest";

import type { Finding } from "@/src/domain";
import {
  TELEGRAM_TEXT,
  decisionNotice,
  escapeTelegramHtml,
  sampleSummaryNotice,
} from "@/src/ui/telegram";

/**
 * P-130: los mensajes del bot escapan el HTML de todo lo que viene de afuera, y el aviso
 * dice qué pasó, de quién, cuánto y por qué, en lenguaje simple.
 */

const finding: Finding = {
  code: "payee_not_allowed",
  severity: "warn",
  action: "escalar",
  observed: "<b>Nube</b> & Cía",
  threshold: "lista de beneficiarios",
  evidence: null,
  field: "payee_name",
  message: "mensaje",
};

describe("mensajes del bot (P-130)", () => {
  it("escapa el HTML del beneficiario, de las razones y del nombre de la empresa", () => {
    expect(escapeTelegramHtml(`<a href="x">&</a>`)).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
    const html = decisionNotice({
      verdict: "escalar",
      status: "esperando_aprobacion",
      reference: "YQ-2026-10-0001",
      payeeName: `<img src=x onerror=alert(1)>`,
      amount: { amount: 480_000_000, currency: "COP" },
      findings: [finding],
      approvedBy: null,
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Nube</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Necesita tu decisión.");
    expect(html).toContain("El beneficiario no está aprobado");
    expect(html).toContain("4.800.000 COP");
    expect(TELEGRAM_TEXT.linked("<Empresa>")).toContain("&lt;Empresa&gt;");
  });

  it("una aprobación dice quién aprobó y no repite las razones", () => {
    const html = decisionNotice({
      verdict: "pagar",
      status: "aprobada",
      reference: "YQ-2026-10-0002",
      payeeName: "Andes Hardware SAS",
      amount: null,
      findings: [finding],
      approvedBy: "Ana Torres",
    });
    expect(html).toContain("Aprobada por Ana Torres");
    expect(html).not.toContain("Por qué");
  });

  it("el resumen de las facturas de ejemplo cuenta en singular y plural", () => {
    expect(sampleSummaryNotice({ total: 33, pagar: 15, escalar: 8, frenar: 10 })).toBe(
      [
        "📋 <b>Facturas de ejemplo de hoy: 33</b>",
        "✅ 15 pagadas dentro de tus reglas",
        "⚠️ 8 esperan tu decisión",
        "⛔ 10 frenadas",
      ].join("\n"),
    );
    expect(sampleSummaryNotice({ total: 1, pagar: 0, escalar: 1, frenar: 0 })).toContain(
      "1 espera tu decisión",
    );
  });
});
