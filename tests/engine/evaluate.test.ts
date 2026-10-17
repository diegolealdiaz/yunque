import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Policy, Verdict } from "@/src/domain";
import { evaluate, type EvaluationContext } from "@/src/engine";

import {
  balances,
  baseContext,
  baseExtraction,
  basePolicy,
  ledger,
  missing,
  present,
  priorPaid,
  vendor,
} from "./fixtures";

/** Orden de permisividad: pagar es lo más permisivo, frenar lo más estricto. */
const RANK: Record<Verdict, number> = { pagar: 0, escalar: 1, frenar: 2 };

const arbControls = fc.record({
  payments_enabled: fc.boolean(),
  dry_run: fc.boolean(),
  autonomy: fc.constantFrom("recomendar" as const, "decidir" as const),
});

/** Contextos aleatorios alrededor de la factura base: montos, política, saldos, historial. */
const arbContext: fc.Arbitrary<EvaluationContext> = fc
  .record({
    totalCop: fc.integer({ min: 100, max: 50_000_000_000 }),
    approvalUsd: fc.integer({ min: 100, max: 2_000_000 }),
    limitUsd: fc.integer({ min: 1_000, max: 100_000_000 }),
    committedUsd: fc.integer({ min: 0, max: 100_000 }),
    balanceCop: fc.integer({ min: 0, max: 100_000_000_000 }),
    priorCount: fc.integer({ min: 0, max: 5 }),
    verified: fc.boolean(),
    matched: fc.boolean(),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    dueOffsetDays: fc.integer({ min: -60, max: 60 }),
    hasAccount: fc.boolean(),
    controls: arbControls,
    ledgerPresent: fc.boolean(),
  })
  .map((r) => {
    const base = basePolicy();
    const policy: Policy = {
      ...base,
      limits: {
        ...base.limits,
        approval_threshold: {
          amount: Math.min(r.approvalUsd, base.limits.per_payment.amount),
          currency: "USD",
        },
        budget: { amount: r.limitUsd, currency: "USD", period: "month" },
      },
      controls: r.controls,
    };
    const due = new Date(Date.UTC(2026, 9, 17) + r.dueOffsetDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const payeeVendor = r.verified
      ? vendor
      : { ...vendor, verification: { status: "pendiente" as const } };
    return baseContext({
      policy,
      extraction: baseExtraction({
        total: present(r.totalCop, "x", r.confidence),
        subtotal: missing(),
        taxes: missing(),
        due_date: present(due, "x"),
        bank_account: r.hasAccount ? present("31245679023", "x") : missing(),
        bank_holder: r.hasAccount ? present("Nube Andina SAS", "x") : missing(),
      }),
      payee: r.matched
        ? { kind: "matched", vendor: payeeVendor, by: "exact" }
        : { kind: "unknown", closest: null },
      ledger: r.ledgerPresent ? ledger(r.limitUsd, Math.min(r.committedUsd, r.limitUsd)) : null,
      balances: balances(r.balanceCop),
      prior: Array.from({ length: r.priorCount }, (_, i) => priorPaid(30 * (i + 1), r.totalCop)),
    });
  });

describe("Juez: invariantes (P-22 a P-33)", () => {
  it("P-22 orden de severidad: frenar gana a escalar; escalar gana a pagar", () => {
    // Umbral superado (escalar) + cuenta distinta (frenar) → frenar.
    const both = baseContext({
      extraction: baseExtraction({
        bank_account: present("99999999999", "x"),
        subtotal: missing(),
        taxes: missing(),
        total: present(30_000_000_000, "x"),
      }),
      ledger: ledger(100_000_000),
      balances: balances(100_000_000_000),
    });
    const result = evaluate(both);
    expect(result.findings.some((f) => f.action === "frenar")).toBe(true);
    expect(result.findings.some((f) => f.action === "escalar")).toBe(true);
    expect(result.verdict).toBe("frenar");

    const onlyEscalar = baseContext({ prior: [] });
    expect(evaluate(onlyEscalar).findings.every((f) => f.action === "escalar")).toBe(true);
    expect(evaluate(onlyEscalar).verdict).toBe("escalar");
  });

  it("P-22 y P-23 propiedad: el veredicto es exactamente la acción más estricta; pagar ⇔ cero hallazgos", () => {
    fc.assert(
      fc.property(arbContext, (ctx) => {
        const { verdict, findings } = evaluate(ctx);
        const strictest = findings.some((f) => f.action === "frenar")
          ? "frenar"
          : findings.some((f) => f.action === "escalar")
            ? "escalar"
            : "pagar";
        expect(verdict).toBe(strictest);
        expect(verdict === "pagar").toBe(findings.length === 0);
        if (verdict === "pagar") expect(findings.every((f) => f.severity !== "block")).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("P-24 propiedad: banderas del modelo solo endurecen el veredicto", () => {
    const arbFlags = fc.record({
      suspicions: fc.array(
        fc.constantFrom("instruction_to_agent", "hidden_text", "canary", "amount_in_words_differs"),
        { maxLength: 2 },
      ),
      ambiguities: fc.array(fc.constantFrom("total", "bank_account", "payee_name"), {
        maxLength: 2,
      }),
    });
    fc.assert(
      fc.property(arbContext, arbFlags, (ctx, flags) => {
        if (ctx.extraction.kind !== "invoice") return;
        const flagged: EvaluationContext = {
          ...ctx,
          extraction: {
            ...ctx.extraction,
            suspicions: flags.suspicions.map((kind) => ({ kind, quote: "q" })),
            ambiguities: flags.ambiguities.map((field) => ({ field, candidates: ["a", "b"] })),
          },
        };
        expect(RANK[evaluate(flagged).verdict]).toBeGreaterThanOrEqual(RANK[evaluate(ctx).verdict]);
      }),
      { numRuns: 1000 },
    );
  });

  it("P-29 propiedad: reproducible, incluido el orden de hallazgos y el registro", () => {
    fc.assert(
      fc.property(arbContext, (ctx) => {
        const a = evaluate(ctx);
        const b = evaluate(structuredClone(ctx));
        expect(b).toEqual(a);
      }),
      { numRuns: 500 },
    );
  });

  it("P-31 propiedad: con pagos apagados nunca pagar, y lo que pagaría lleva payments_disabled", () => {
    fc.assert(
      fc.property(arbContext, (ctx) => {
        const on: EvaluationContext = {
          ...ctx,
          policy: {
            ...ctx.policy,
            controls: { ...ctx.policy.controls, payments_enabled: true, autonomy: "decidir" },
          },
        };
        const off: EvaluationContext = {
          ...ctx,
          policy: {
            ...ctx.policy,
            controls: { ...ctx.policy.controls, payments_enabled: false, autonomy: "decidir" },
          },
        };
        const withOff = evaluate(off);
        expect(withOff.verdict).not.toBe("pagar");
        if (evaluate(on).verdict === "pagar") {
          expect(withOff.verdict).toBe("escalar");
          expect(withOff.findings.map((f) => f.code)).toEqual(["payments_disabled"]);
          expect(withOff.scheduled_for).toBeNull();
        } else {
          expect(withOff.findings.some((f) => f.code === "payments_disabled")).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("autonomía recomendar: lo que pagaría se escala con su hallazgo", () => {
    const ctx = baseContext({
      policy: {
        ...basePolicy(),
        controls: { payments_enabled: true, dry_run: false, autonomy: "recomendar" },
      },
    });
    const result = evaluate(ctx);
    expect(result.verdict).toBe("escalar");
    expect(result.findings.map((f) => f.code)).toEqual(["autonomy_recomendar"]);
  });

  it("P-33 propiedad: extracción nula, ledger ausente o regla que lanza nunca producen pagar ni excepción", () => {
    const broken = fc.constantFrom<
      "unreadable" | "not_invoice" | "no_ledger" | "throwing_fx" | "no_balances"
    >("unreadable", "not_invoice", "no_ledger", "throwing_fx", "no_balances");
    fc.assert(
      fc.property(arbContext, broken, (ctx, kind) => {
        const damaged: EvaluationContext =
          kind === "unreadable"
            ? { ...ctx, extraction: { kind: "unreadable", reason: "vacío" } }
            : kind === "not_invoice"
              ? { ...ctx, extraction: { kind: "not_invoice", reason: "recibo", suspicions: [] } }
              : kind === "no_ledger"
                ? { ...ctx, ledger: null }
                : kind === "no_balances"
                  ? { ...ctx, balances: [] }
                  : { ...ctx, fx: { ...ctx.fx, perUsd: { ...ctx.fx.perUsd, COP: Number.NaN } } };
        const result = evaluate(damaged);
        expect(result.verdict).not.toBe("pagar");
        if (kind === "throwing_fx") {
          expect(result.findings.some((f) => f.code === "rule_error")).toBe(true);
          expect(result.verdict).toBe("frenar");
        }
      }),
      { numRuns: 300 },
    );
  });

  it("la fecha programada solo existe con pagar y nunca es anterior a hoy", () => {
    fc.assert(
      fc.property(arbContext, (ctx) => {
        const result = evaluate(ctx);
        if (result.verdict === "pagar") {
          expect(result.scheduled_for).not.toBeNull();
          expect((result.scheduled_for ?? "") >= "2026-10-17").toBe(true);
        } else {
          expect(result.scheduled_for).toBeNull();
        }
      }),
      { numRuns: 500 },
    );
  });
});
