import { describe, expect, it } from "vitest";

import { checklistComplete } from "@/src/domain/approval";
import { CURRENCIES, RAILS, railSupportsCurrency } from "@/src/domain/currency";
import { DecisionSchema } from "@/src/domain/decision";
import { ExtractedFieldNameSchema } from "@/src/domain/extraction";
import { hasBlocking, type Finding } from "@/src/domain/finding";
import { canTransition, isFinalStatus, type InvoiceStatus } from "@/src/domain/invoice";
import { BankAccountSchema, VendorSchema, maskAccount } from "@/src/domain/vendor";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const HASH = "a".repeat(64);

describe("máquina de estados de la factura", () => {
  const allowed: [InvoiceStatus, InvoiceStatus][] = [
    ["recibida", "procesando"],
    ["procesando", "decidida"],
    ["procesando", "esperando_aprobacion"],
    ["procesando", "fallida"],
    ["procesando", "recibida"],
    ["decidida", "procesando"],
    ["esperando_aprobacion", "aprobada"],
    ["esperando_aprobacion", "rechazada"],
    ["esperando_aprobacion", "procesando"],
    ["fallida", "procesando"],
  ];

  it.each(allowed)("permite %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["recibida", "decidida"],
    ["recibida", "aprobada"],
    ["decidida", "aprobada"],
    ["aprobada", "procesando"],
    ["rechazada", "procesando"],
    ["fallida", "decidida"],
    ["esperando_aprobacion", "decidida"],
  ] satisfies [InvoiceStatus, InvoiceStatus][])("prohíbe %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("solo aprobada y rechazada son finales", () => {
    expect(isFinalStatus("aprobada")).toBe(true);
    expect(isFinalStatus("rechazada")).toBe(true);
    expect(isFinalStatus("decidida")).toBe(false);
    expect(isFinalStatus("esperando_aprobacion")).toBe(false);
  });
});

describe("monedas y rutas", () => {
  it("cada moneda tiene al menos una ruta y cada ruta sirve a una sola moneda", () => {
    for (const currency of CURRENCIES) {
      expect(RAILS.some((rail) => railSupportsCurrency(rail, currency))).toBe(true);
    }
    for (const rail of RAILS) {
      const served = CURRENCIES.filter((c) => railSupportsCurrency(rail, c));
      expect(served).toHaveLength(1);
    }
  });

  it("casos concretos de la tabla", () => {
    expect(railSupportsCurrency("pix", "BRL")).toBe(true);
    expect(railSupportsCurrency("pix", "USD")).toBe(false);
    expect(railSupportsCurrency("spei", "MXN")).toBe(true);
    expect(railSupportsCurrency("bre_b", "COP")).toBe(true);
  });
});

describe("vendor y cuenta", () => {
  const account = {
    country: "BR",
    currency: "BRL",
    rail: "pix",
    account_number: "12345678901",
    holder_name: "Ana Souza",
  };

  it("acepta una cuenta coherente y enmascara el número", () => {
    expect(BankAccountSchema.safeParse(account).success).toBe(true);
    expect(maskAccount("12345678901")).toBe("****8901");
    expect(maskAccount("12")).toBe("****12");
  });

  it("rechaza ruta que no sirve para la moneda y moneda ajena a la región", () => {
    expect(BankAccountSchema.safeParse({ ...account, rail: "spei" }).success).toBe(false);
    expect(BankAccountSchema.safeParse({ ...account, country: "MX" }).success).toBe(false);
  });

  it("la región del vendor debe coincidir con la de su cuenta", () => {
    const vendor = {
      id: ULID,
      organization_id: ULID,
      name: "Ana Souza",
      aliases: [],
      country: "BR",
      account,
      verification: { status: "pendiente" },
      agreement: { kind: "none" },
      created_at: "2026-10-17T00:00:00.000Z",
    };
    expect(VendorSchema.safeParse(vendor).success).toBe(true);
    expect(VendorSchema.safeParse({ ...vendor, country: "CO" }).success).toBe(false);
    expect(VendorSchema.safeParse({ ...vendor, extra: 1 }).success).toBe(false);
  });
});

describe("hallazgos, checklist y decisión", () => {
  const warn: Finding = {
    code: "first_payment_to_vendor",
    severity: "warn",
    action: "escalar",
    observed: "sin pagos previos",
    threshold: "al menos uno",
    evidence: null,
    field: null,
    message: "Primer pago a este beneficiario",
  };
  const block: Finding = {
    ...warn,
    code: "amount_over_hard_limit",
    severity: "block",
    action: "frenar",
  };

  it("hasBlocking y checklistComplete", () => {
    expect(hasBlocking([])).toBe(false);
    expect(hasBlocking([warn])).toBe(false);
    expect(hasBlocking([warn, block])).toBe(true);
    expect(checklistComplete([])).toBe(false);
    expect(checklistComplete([{ code: "general", text: "x", checked: false }])).toBe(false);
    expect(checklistComplete([{ code: "general", text: "x", checked: true }])).toBe(true);
  });

  it("los nombres de campo salen del esquema de extracción", () => {
    expect(ExtractedFieldNameSchema.safeParse("payee_name").success).toBe(true);
    expect(ExtractedFieldNameSchema.safeParse("nombre").success).toBe(false);
  });

  const order = {
    status: "preparada_no_ejecutada",
    vendor_id: ULID,
    beneficiary_name: "Ana Souza",
    amount: { amount: 100_000, currency: "BRL" },
    rail: "pix",
    account_masked: "****8901",
    source_account_id: "acct_demo",
    scheduled_for: "2026-10-20",
    reference: "YQ-2026-10-0001",
  };
  const decision = {
    id: ULID,
    organization_id: ULID,
    invoice_id: ULID,
    verdict: "pagar",
    findings: [warn],
    explanation: "Todas las reglas pasan.",
    summary: null,
    scheduled_for: "2026-10-20",
    payment_order: order,
    amount: { amount: 100_000, currency: "BRL" },
    amount_usd: { amount: 18_797, currency: "USD" },
    vendor_id: ULID,
    policy_version_id: ULID,
    policy_hash: HASH,
    document_hash: HASH,
    extraction_hash: HASH,
    field_sources: { total: "modelo" },
    previous_decision_id: null,
    dry_run: false,
    actor: { kind: "agente" },
    cost_usd_micros: 120,
    latency_ms: 900,
    decided_at: "2026-10-17T00:00:00.000Z",
  };

  it("pagar exige cero block, orden y fecha coherente", () => {
    expect(DecisionSchema.safeParse(decision).success).toBe(true);
    expect(DecisionSchema.safeParse({ ...decision, findings: [block] }).success).toBe(false);
    expect(DecisionSchema.safeParse({ ...decision, payment_order: null }).success).toBe(false);
    expect(DecisionSchema.safeParse({ ...decision, scheduled_for: "2026-10-21" }).success).toBe(
      false,
    );
  });

  it("en modo de prueba, pagar se registra con fecha pero sin orden de pago", () => {
    const dry = { ...decision, dry_run: true, payment_order: null };
    expect(DecisionSchema.safeParse(dry).success).toBe(true);
    expect(DecisionSchema.safeParse({ ...decision, dry_run: true }).success).toBe(false);
    expect(DecisionSchema.safeParse({ ...dry, scheduled_for: null }).success).toBe(false);
  });

  it("frenar y escalar no llevan orden de pago", () => {
    const frenar = {
      ...decision,
      verdict: "frenar",
      findings: [block],
      payment_order: null,
      scheduled_for: null,
    };
    expect(DecisionSchema.safeParse(frenar).success).toBe(true);
    expect(DecisionSchema.safeParse({ ...frenar, payment_order: order }).success).toBe(false);
    expect(
      DecisionSchema.safeParse({ ...decision, field_sources: { nombre: "modelo" } }).success,
    ).toBe(false);
  });
});
