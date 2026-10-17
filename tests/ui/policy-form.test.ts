import { describe, expect, it } from "vitest";

import { defaultPolicy, policyEditToYaml } from "@/src/domain/policy";
import { CONFIGURABLE_RULES } from "@/src/domain/rules";
import {
  ALLOWED_PAYEES_PATH,
  BUDGET_PERIOD_PATH,
  LIMIT_FIELDS,
  PARAMETER_FIELDS,
  RULE_COPY,
  displayValue,
  parseFieldInput,
  readPolicyYaml,
  readStringList,
  toggleListItem,
  writePolicyYaml,
} from "@/src/ui/policy-form";

/**
 * El formulario de Reglas sobre el YAML (docs/interfaz.md §5.4): sus rutas existen en la
 * política, cada regla configurable tiene su frase, y lo que se escribe se valida antes de
 * tocar el documento.
 */

const yaml = policyEditToYaml(
  defaultPolicy({
    systemHardCapUsdCents: 10_000_000,
    sourceAccountId: "cuenta",
    approvers: ["Ana"],
  }),
);

describe("formulario de la política", () => {
  it("cada campo apunta a una clave que existe en la política de fábrica", () => {
    const { ok, get } = readPolicyYaml(yaml);
    expect(ok).toBe(true);
    for (const spec of [...LIMIT_FIELDS, ...PARAMETER_FIELDS]) {
      expect(typeof get(spec.path), spec.path.join(".")).toBe("number");
    }
    expect(get(BUDGET_PERIOD_PATH)).toBe("month");
  });

  it("cada regla configurable tiene nombre y frase, con los valores vigentes", () => {
    const { get } = readPolicyYaml(yaml);
    for (const code of CONFIGURABLE_RULES) {
      const copy = RULE_COPY[code];
      expect(copy, code).toBeDefined();
      expect(copy?.help(get)).not.toContain("—");
    }
    expect(RULE_COPY.vendor_velocity?.help(get)).toContain("5 o más facturas");
  });

  it("muestra dólares y porcentajes, y guarda centavos y puntos básicos", () => {
    const [perPayment] = LIMIT_FIELDS;
    const tolerance = PARAMETER_FIELDS.find((f) => f.kind === "percent");
    if (!perPayment || !tolerance) throw new Error("faltan campos");
    expect(displayValue(perPayment, 2_000_000)).toBe("20000.00");
    expect(parseFieldInput(perPayment, "1234,5")).toEqual({ ok: true, value: 123_450 });
    expect(displayValue(tolerance, 500)).toBe("5");
    expect(parseFieldInput(tolerance, "7.5")).toEqual({ ok: true, value: 750 });
  });

  it("rechaza lo que no vale con un motivo, sin tocar el YAML", () => {
    const days = PARAMETER_FIELDS.find((f) => f.kind === "int");
    const ratio = PARAMETER_FIELDS.find((f) => f.kind === "ratio");
    if (!days || !ratio) throw new Error("faltan campos");
    expect(parseFieldInput(days, "")).toMatchObject({ ok: false });
    expect(parseFieldInput(days, "abc")).toMatchObject({ ok: false });
    expect(parseFieldInput(days, "-3")).toEqual({ ok: false, message: "No puede ser negativo." });
    expect(parseFieldInput(days, "2.5")).toEqual({
      ok: false,
      message: "Escribe un número entero.",
    });
    expect(parseFieldInput(ratio, "1.2")).toEqual({ ok: false, message: "Va de 0 a 1." });
    expect(parseFieldInput(ratio, "0,9")).toEqual({ ok: true, value: 0.9 });
  });

  it("escribir una clave conserva el resto del documento", () => {
    const next = writePolicyYaml(yaml, ["rules", "duplicate_invoice", "window_days"], 30);
    const { get } = readPolicyYaml(next);
    expect(get(["rules", "duplicate_invoice", "window_days"])).toBe(30);
    expect(get(["limits", "per_payment", "amount"])).toBe(
      readPolicyYaml(yaml).get(["limits", "per_payment", "amount"]),
    );
  });
});

describe("lista de beneficiarios permitidos", () => {
  const base = "allowed_payees:\n  - a\n  - b\nlimits:\n  approval_threshold_usd_cents: 500000\n";

  it("lee la lista y la deja vacía si falta o el YAML está roto", () => {
    expect(readStringList(base, ALLOWED_PAYEES_PATH)).toEqual(["a", "b"]);
    expect(readStringList("limits: {}\n", ALLOWED_PAYEES_PATH)).toEqual([]);
    expect(readStringList("allowed_payees: [\n", ALLOWED_PAYEES_PATH)).toEqual([]);
  });

  it("agrega sin duplicar y quita, sin tocar el resto del documento", () => {
    const added = toggleListItem(base, ALLOWED_PAYEES_PATH, "c", true);
    expect(readStringList(added, ALLOWED_PAYEES_PATH)).toEqual(["a", "b", "c"]);
    expect(toggleListItem(added, ALLOWED_PAYEES_PATH, "c", true)).toBe(added);
    const removed = toggleListItem(added, ALLOWED_PAYEES_PATH, "a", false);
    expect(readStringList(removed, ALLOWED_PAYEES_PATH)).toEqual(["b", "c"]);
    expect(removed).toContain("approval_threshold_usd_cents: 500000");
  });
});
