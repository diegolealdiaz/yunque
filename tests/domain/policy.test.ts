import { describe, expect, it } from "vitest";

import {
  PolicyError,
  applyPolicyEdit,
  defaultPolicy,
  effectiveHardCapUsdCents,
  onFailOf,
  parsePolicy,
  policyEditFromYaml,
  policyEditToYaml,
  policyHash,
  type Policy,
} from "@/src/domain/policy";

const base: Policy = defaultPolicy({
  systemHardCapUsdCents: 10_000_000,
  sourceAccountId: "acct_demo",
  approvers: ["Diego Leal"],
});

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof PolicyError) return [...error.problems];
    throw error;
  }
  throw new Error("se esperaba PolicyError");
}

function clone(policy: Policy): Record<string, unknown> {
  return JSON.parse(JSON.stringify(policy)) as Record<string, unknown>;
}

describe("política (P-12)", () => {
  it("la política de fábrica es válida y queda congelada", () => {
    expect(parsePolicy(clone(base))).toEqual(base);
    expect(Object.isFrozen(base)).toBe(true);
    expect(Object.isFrozen(base.limits)).toBe(true);
    expect(Object.isFrozen(base.rules.duplicate_invoice)).toBe(true);
  });

  it("rechaza claves desconocidas en cualquier nivel", () => {
    const top = { ...clone(base), extra: 1 };
    expect(problemsOf(() => parsePolicy(top))[0]).toContain("extra");

    const nested = clone(base);
    (nested["limits"] as Record<string, unknown>)["max_per_day"] = 1;
    expect(problemsOf(() => parsePolicy(nested))[0]).toContain("limits");

    const rule = clone(base);
    ((rule["rules"] as Record<string, unknown>)["duplicate_invoice"] as Record<string, unknown>)[
      "severity"
    ] = "warn";
    expect(problemsOf(() => parsePolicy(rule))[0]).toContain("duplicate_invoice");
  });

  it("on_fail solo admite frenar o escalar", () => {
    const bad = clone(base);
    ((bad["rules"] as Record<string, unknown>)["duplicate_invoice"] as Record<string, unknown>)[
      "on_fail"
    ] = "pagar";
    expect(problemsOf(() => parsePolicy(bad)).some((p) => p.includes("on_fail"))).toBe(true);
  });

  it("las reglas no configurables no existen en rules: su acción es la de fábrica", () => {
    const bad = clone(base);
    (bad["rules"] as Record<string, unknown>)["amount_over_hard_limit"] = { on_fail: "escalar" };
    expect(problemsOf(() => parsePolicy(bad))).toEqual([
      'rules: Unrecognized key: "amount_over_hard_limit"',
    ]);
    expect(onFailOf(base, "amount_over_hard_limit")).toBe("frenar");
    expect(onFailOf(base, "duplicate_invoice")).toBe("frenar");
    expect(onFailOf(base, "field_low_confidence")).toBe("escalar");
  });

  it("el umbral de aprobación no supera el límite por pago", () => {
    const bad = clone(base);
    (bad["limits"] as Record<string, Record<string, unknown>>)["approval_threshold"] = {
      amount: 3_000_000,
      currency: "USD",
    };
    expect(problemsOf(() => parsePolicy(bad))).toEqual([
      "limits.approval_threshold no puede superar limits.per_payment",
    ]);
  });

  it("los límites van en USD y el límite por pago no supera el tope del sistema", () => {
    const foreign = clone(base);
    (foreign["limits"] as Record<string, Record<string, unknown>>)["approval_threshold"] = {
      amount: 1,
      currency: "EUR",
    };
    expect(problemsOf(() => parsePolicy(foreign))[0]).toContain("approval_threshold.currency");

    const over = clone(base);
    (over["limits"] as Record<string, Record<string, unknown>>)["per_payment"] = {
      amount: 10_000_001,
      currency: "USD",
    };
    expect(problemsOf(() => parsePolicy(over))).toEqual([
      "limits.per_payment no puede superar el tope absoluto del sistema",
    ]);
  });

  it("las claves protegidas no se editan desde el formulario", () => {
    const edit = {
      limits: base.limits,
      allowed_payees: base.allowed_payees,
      rules: base.rules,
      protected: { ...base.protected, system_hard_cap_usd_cents: 1 },
    };
    expect(problemsOf(() => applyPolicyEdit(base, edit as never))[0]).toContain("protected");

    const edited = applyPolicyEdit(base, {
      limits: {
        ...base.limits,
        per_payment: { amount: 1_500_000, currency: "USD" },
      },
      allowed_payees: base.allowed_payees,
      rules: base.rules,
    });
    expect(edited.limits.per_payment.amount).toBe(1_500_000);
    expect(edited.protected).toEqual(base.protected);
    expect(edited.controls).toEqual(base.controls);
  });

  it("el tope absoluto del sistema no se sobrescribe desde la política", () => {
    expect(effectiveHardCapUsdCents(base)).toBe(2_000_000);
    const tight = defaultPolicy({
      systemHardCapUsdCents: 1_000_000,
      sourceAccountId: "acct_demo",
      approvers: ["Diego Leal"],
    });
    expect(tight.limits.per_payment.amount).toBe(1_000_000);
    expect(effectiveHardCapUsdCents(tight)).toBe(1_000_000);
  });

  it("YAML y formulario producen el mismo objeto", () => {
    const yaml = policyEditToYaml(base);
    expect(yaml).not.toContain("protected");
    expect(yaml).not.toContain("controls");
    const fromYaml = policyEditFromYaml(yaml);
    expect(fromYaml).toEqual({
      limits: base.limits,
      allowed_payees: base.allowed_payees,
      rules: base.rules,
    });
    expect(applyPolicyEdit(base, fromYaml)).toEqual(base);
  });

  it("el YAML rechaza claves protegidas, de control o desconocidas", () => {
    const withProtected = `${policyEditToYaml(base)}protected:\n  system_hard_cap_usd_cents: 1\n`;
    expect(problemsOf(() => policyEditFromYaml(withProtected))[0]).toContain("protected");

    const withControls = `${policyEditToYaml(base)}controls:\n  payments_enabled: true\n`;
    expect(problemsOf(() => policyEditFromYaml(withControls))[0]).toContain("controls");

    expect(() => policyEditFromYaml("limits: [")).toThrow(PolicyError);
    expect(() => policyEditFromYaml("a: &x 1\nb: *x\n")).toThrow(PolicyError);
  });

  it("el parser rechaza lo que zod no vería: claves duplicadas, etiquetas y varios documentos", () => {
    const yaml = policyEditToYaml(base);
    const duplicated = `${yaml}allowed_payees: []\n`;
    expect(problemsOf(() => policyEditFromYaml(duplicated))[0]).toMatch(/duplicate|unique/i);

    const tagged = yaml.replace("allowed_payees: []", "allowed_payees: !!js/function 'x'");
    expect(problemsOf(() => policyEditFromYaml(tagged))[0]).toMatch(/tag/i);

    const twoDocs = `${yaml}---\nlimits: {}\n`;
    expect(() => policyEditFromYaml(twoDocs)).toThrow(PolicyError);

    expect(problemsOf(() => policyEditFromYaml("a".repeat(100_001)))).toEqual([
      "El YAML supera el tamaño máximo",
    ]);
  });

  it("limita la lista de beneficiarios permitidos", () => {
    const ids = Array.from({ length: 1001 }, () => "01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(() => applyPolicyEdit(base, { ...clone(base), allowed_payees: ids } as never)).toThrow(
      PolicyError,
    );
  });

  it("el hash de la política es estable ante el orden de las claves", () => {
    const reordered = parsePolicy({
      controls: base.controls,
      protected: base.protected,
      rules: base.rules,
      allowed_payees: base.allowed_payees,
      limits: base.limits,
      schema_version: 1,
    });
    expect(policyHash(reordered)).toBe(policyHash(base));
    const changed = applyPolicyEdit(base, {
      limits: base.limits,
      allowed_payees: base.allowed_payees,
      rules: { ...base.rules, duplicate_invoice: { on_fail: "escalar", window_days: 90 } },
    });
    expect(policyHash(changed)).not.toBe(policyHash(base));
  });

  it("valida rangos de parámetros", () => {
    const bad = clone(base);
    ((bad["rules"] as Record<string, unknown>)["amount_mismatch"] as Record<string, unknown>)[
      "tolerance_bp"
    ] = 20_000;
    expect(problemsOf(() => parsePolicy(bad))[0]).toContain("tolerance_bp");

    const badConfidence = clone(base);
    (
      (badConfidence["rules"] as Record<string, unknown>)["field_low_confidence"] as Record<
        string,
        unknown
      >
    )["min_confidence"] = 1.5;
    expect(problemsOf(() => parsePolicy(badConfidence))[0]).toContain("min_confidence");
  });
});
