import { describe, expect, it } from "vitest";

import { decidingRule, simulateDataset } from "./simulate";

describe("dataset contra el motor, en orden (P-50)", () => {
  it("cada caso produce el veredicto esperado y su regla es la que lo decide", async () => {
    const { cases } = await simulateDataset();
    const report = cases.map((c) => ({
      id: c.id,
      esperado: `${c.expectedVerdict}/${c.expectedRule ?? "-"}`,
      obtenido: `${c.evaluation.verdict}/${decidingRule(c.evaluation) ?? "-"}`,
      hallazgos: c.evaluation.findings.map((f) => `${f.code}:${f.action}`).join(","),
    }));
    const wrong = report.filter((r) => r.esperado !== r.obtenido);
    expect(wrong, JSON.stringify(wrong, null, 2)).toEqual([]);
  }, 120_000);

  it("cero falsos pagar y exactamente una factura cae en saldo insuficiente", async () => {
    const { cases } = await simulateDataset();
    const falsePay = cases.filter(
      (c) => c.evaluation.verdict === "pagar" && c.expectedVerdict !== "pagar",
    );
    expect(falsePay.map((c) => c.id)).toEqual([]);
    const balanceHits = cases.filter((c) =>
      c.evaluation.findings.some((f) => f.code === "insufficient_balance"),
    );
    expect(balanceHits.map((c) => c.id)).toEqual(["saldo_insuficiente"]);
  }, 120_000);
});
