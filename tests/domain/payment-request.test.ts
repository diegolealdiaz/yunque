import { describe, expect, it } from "vitest";

import {
  PaymentRequestSchema,
  decimalText,
  minorUnits,
  paymentRequestLines,
  type PaymentRequest,
} from "@/src/domain";

/**
 * P-158: la solicitud de pago de la API (D32). Los montos llegan como texto decimal y se
 * convierten a unidad mínima sin punto flotante; lo que rompería su línea del documento
 * (saltos, caracteres de control) o no es un monto exacto se rechaza en el borde.
 */

const BASE: PaymentRequest = {
  idempotency_key: "pago-001",
  payee_name: "Nube Andina SAS",
  invoice_number: "NA-2026-10",
  currency: "COP",
  total: "4800000.00",
};

describe("montos de la solicitud (P-158)", () => {
  it.each([
    ["1200", "USD", 120000],
    ["1200.5", "USD", 120050],
    ["1200.05", "USD", 120005],
    ["0.01", "USD", 1],
    ["4800000.00", "COP", 480000000],
    ["9999999999999.99", "USD", 999999999999999],
  ] as const)("%s %s es %i en unidad mínima", (text, currency, minor) => {
    expect(minorUnits(text, currency)).toBe(minor);
  });

  it.each([
    [120050, "USD", "1200.50"],
    [1, "USD", "0.01"],
    [0, "EUR", "0.00"],
  ] as const)("%i %s se escribe %s", (minor, currency, text) => {
    expect(decimalText(minor, currency)).toBe(text);
  });

  it.each([12, "12,00", "1.200,00", "1e3", "-5.00", "0", "0.00", "1.234", ".5", "01.00"])(
    "rechaza el total %s",
    (total) => {
      expect(PaymentRequestSchema.safeParse({ ...BASE, total }).success).toBe(false);
    },
  );
});

describe("bordes de la solicitud (P-158)", () => {
  it("rechaza saltos de línea y caracteres de control en el texto", () => {
    for (const description of [
      "línea uno\nlínea dos",
      "tab\tdentro",
      `nulo${String.fromCharCode(0)}`,
    ]) {
      expect(PaymentRequestSchema.safeParse({ ...BASE, description }).success).toBe(false);
    }
  });

  it("rechaza campos desconocidos, monedas fuera del catálogo y llaves inseguras", () => {
    expect(PaymentRequestSchema.safeParse({ ...BASE, approved_by: "CFO" }).success).toBe(false);
    expect(PaymentRequestSchema.safeParse({ ...BASE, currency: "GBP" }).success).toBe(false);
    expect(PaymentRequestSchema.safeParse({ ...BASE, idempotency_key: "a/b" }).success).toBe(false);
  });

  it("recorta espacios y deja los montos normalizados en sus líneas", () => {
    const request = PaymentRequestSchema.parse({
      ...BASE,
      payee_name: "  Nube Andina SAS ",
      subtotal: "4000000",
      taxes: "800000.0",
    });
    const lines = paymentRequestLines(request);
    expect(lines.find((l) => l.field === "payee_name")?.literal).toBe("Nube Andina SAS");
    expect(lines.find((l) => l.field === "subtotal")).toMatchObject({
      literal: "4000000.00",
      value: 400000000,
    });
    expect(lines.find((l) => l.field === "taxes")?.literal).toBe("800000.00");
    // Un campo ausente no da línea: no hay nada que citar.
    expect(lines.some((l) => l.field === "bank_account")).toBe(false);
  });
});
