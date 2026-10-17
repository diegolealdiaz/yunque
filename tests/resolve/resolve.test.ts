import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Vendor } from "@/src/domain";
import { evaluate } from "@/src/engine";
import { comparableName, resolvePayee, similarity } from "@/src/resolve";

import { baseContext, baseExtraction, present as fixturePresent } from "../engine/fixtures";
import { seedVendors } from "../extraction/helpers";

const present = (value: string) => ({
  value,
  evidence: { literal: value, quote: value, page: 1 },
  confidence: 0.9,
  source: "modelo" as const,
});
const missing = { value: null, reason: "no aparece" };
const input = (name: string, taxId: string | null) => ({
  payee_name: present(name),
  payee_tax_id: taxId === null ? missing : present(taxId),
});

describe("Resolutor (P-70 a P-73)", () => {
  it("P-70 variantes de razón social resuelven al mismo vendor", async () => {
    const vendors = [...(await seedVendors()).values()];
    for (const name of [
      "Nube Andina S.A.S.",
      "NUBE ANDINA SAS",
      "nube andina s.a.s",
      "Nube  Andina",
      "Nube Andina SAS.",
    ]) {
      const match = resolvePayee(input(name, null), vendors);
      expect(match.kind, name).toBe("matched");
      if (match.kind === "matched") expect(match.vendor.name).toBe("Nube Andina SAS");
    }
    expect(comparableName("Peña & Gómez Ltda.")).toBe("PENA GOMEZ LTDA");
  });

  it("P-70 propiedad: puntuación, mayúsculas y tildes no cambian la resolución", async () => {
    const vendors = [...(await seedVendors()).values()];
    const noise = fc.array(fc.constantFrom(".", ",", " ", "  ", "-"), { maxLength: 4 });
    fc.assert(
      fc.property(
        fc.constantFrom(...vendors.map((v) => v.name)),
        fc.boolean(),
        noise,
        (name, upper, n) => {
          const noisy = `${n.join("")}${upper ? name.toUpperCase() : name.toLowerCase()}${n.join("")}`;
          const match = resolvePayee(input(noisy, null), vendors);
          expect(match.kind).toBe("matched");
          if (match.kind === "matched")
            expect(comparableName(match.vendor.name)).toBe(comparableName(name));
        },
      ),
    );
  });

  it("P-71 nombre parecido resuelve desconocido con el más cercano; nombre nuevo, desconocido sin cercano; ambos disparan payee_not_allowed", async () => {
    const vendors = [...(await seedVendors()).values()];
    const similar = resolvePayee(input("Nube Andina Ltda", "901234567-9"), vendors);
    expect(similar.kind).toBe("unknown");
    if (similar.kind === "unknown") {
      expect(similar.closest?.vendor.name).toBe("Nube Andina SAS");
      expect(similar.closest?.similarity ?? 0).toBeGreaterThan(0.6);
    }
    const unknown = resolvePayee(input("Soluciones Cloud SAS", "901999888-1"), vendors);
    expect(unknown).toEqual({ kind: "unknown", closest: null });
    for (const payee of [similar, unknown]) {
      const result = evaluate(
        baseContext({
          payee,
          extraction: baseExtraction({ payee_name: fixturePresent("x", "x") }),
        }),
      );
      expect(result.findings.map((f) => f.code)).toContain("payee_not_allowed");
    }
    expect(similarity("NUBE ANDINA", "NUBE ANDINA")).toBe(1);
    expect(similarity("NUBE ANDINA", "SOLUCIONES CLOUD")).toBeLessThan(0.3);
  });

  it("P-72 el identificador fiscal gana sobre el nombre; alias resuelve; cuenta y titular distintos disparan en el motor", async () => {
    const vendors = [...(await seedVendors()).values()];
    const byTax = resolvePayee(input("Nombre Cualquiera", "901.234.567-8"), vendors);
    expect(byTax).toMatchObject({ kind: "matched", by: "tax_id" });
    const byAlias = resolvePayee(input("C. Rojas", null), vendors);
    expect(byAlias).toMatchObject({ kind: "matched", by: "alias" });

    const account = evaluate(
      baseContext({
        extraction: baseExtraction({ bank_account: fixturePresent("31245679099", "x") }),
      }),
    );
    expect(account.findings.map((f) => f.code)).toEqual(["bank_account_mismatch"]);
    const holder = evaluate(
      baseContext({
        extraction: baseExtraction({ bank_holder: fixturePresent("Otra Persona", "x") }),
      }),
    );
    expect(holder.findings.map((f) => f.code)).toEqual(["account_holder_mismatch"]);
  });

  it("P-73 propiedad: nunca devuelve un vendor fuera de la lista ni una cuenta que no sea la registrada", async () => {
    const vendors = [...(await seedVendors()).values()];
    const accounts = new Set(vendors.map((v) => v.account.account_number));
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
        (name, taxId) => {
          const match = resolvePayee(input(name, taxId), vendors);
          if (match.kind === "matched") {
            expect(vendors.map((v: Vendor) => v.id)).toContain(match.vendor.id);
            expect(accounts.has(match.vendor.account.account_number)).toBe(true);
          } else if (match.closest) {
            expect(vendors.map((v: Vendor) => v.id)).toContain(match.closest.vendor.id);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
