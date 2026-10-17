import type {
  Balance,
  Evidence,
  ExtractedFields,
  Extraction,
  FxTable,
  LedgerPeriod,
  Policy,
  Vendor,
} from "@/src/domain";
import { defaultPolicy } from "@/src/domain";
import type { EvaluationContext, PayeeMatch, PriorInvoice, VerificationReport } from "@/src/engine";

/**
 * Contexto base para las pruebas del motor: una factura normal de Nube Andina por
 * 4.800.000 COP que debe terminar en `pagar`. Cada prueba cambia una sola cosa.
 */

export const NOW = new Date("2026-10-17T15:00:00.000Z");
export const ORG_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
export const VENDOR_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
export const OTHER_VENDOR_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
export const INVOICE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FC0";
export const DOC_HASH = "d".repeat(64);
export const SEMANTIC_KEY = "NUBE ANDINA SAS|F2291|480000000|COP";

export const fx: FxTable = {
  base: "USD",
  asOf: "2026-10-01",
  perUsd: {
    USD: 1_000_000,
    EUR: 920_000,
    COP: 4_150_250_000,
    BRL: 5_320_000,
    MXN: 18_250_000,
    ARS: 1_450_000_000,
  },
};

export const vendor: Vendor = {
  id: VENDOR_ID,
  organization_id: ORG_ID,
  name: "Nube Andina SAS",
  aliases: ["Nube Andina", "NUBE ANDINA S.A.S."],
  tax_id: "901234567-8",
  country: "CO",
  account: {
    country: "CO",
    currency: "COP",
    rail: "bre_b",
    account_number: "31245679023",
    bank_code: "007",
    holder_name: "Nube Andina SAS",
  },
  verification: { status: "verificado", by: "Diego Leal", at: "2026-08-02T14:00:00.000Z" },
  agreement: {
    kind: "recurring",
    expected: { amount: 480_000_000, currency: "COP" },
    period: "month",
  },
  created_at: "2026-08-01T00:00:00.000Z",
};

export function evidence(literal: string): Evidence {
  return { literal, quote: `... ${literal} ...`, page: 1 };
}

export function present<T>(value: T, literal: string, confidence = 0.97) {
  return { value, evidence: evidence(literal), confidence, source: "modelo" as const };
}

export const missing = (reason = "no aparece") => ({ value: null, reason });

export function baseFields(): ExtractedFields {
  return {
    payee_name: present("Nube Andina SAS", "Nube Andina SAS"),
    payee_tax_id: present("901234567-8", "NIT 901234567-8"),
    invoice_number: present("F-2291", "Factura F-2291"),
    issue_date: present("2026-10-10", "10/10/2026"),
    due_date: present("2026-10-25", "Vence 25/10/2026"),
    currency: present("COP", "COP"),
    subtotal: present(403_361_345, "4.033.613,45"),
    taxes: present(76_638_655, "766.386,55"),
    total: present(480_000_000, "4.800.000"),
    bank_account: present("312-4567-9023", "Cuenta 312-4567-9023"),
    bank_holder: present("Nube Andina SAS", "Titular Nube Andina SAS"),
    hours: missing(),
    purchase_order: missing(),
    description: present("Hosting octubre", "Hosting octubre"),
  };
}

export function baseExtraction(fields: Partial<ExtractedFields> = {}): Extraction {
  return {
    kind: "invoice",
    fields: { ...baseFields(), ...fields },
    ambiguities: [],
    suspicions: [],
    language: "es",
  };
}

export const cleanVerification: VerificationReport = {
  evidence_missing: [],
  totals: "ok",
  ambiguities: [],
  suspicions: [],
};

export function basePolicy(overrides: Partial<Policy> = {}): Policy {
  const base = defaultPolicy({
    systemHardCapUsdCents: 10_000_000,
    sourceAccountId: "acct_demo",
    approvers: ["Diego Leal"],
  });
  return { ...base, allowed_payees: [VENDOR_ID], ...overrides };
}

export function ledger(limit = 5_000_000, committed = 0): LedgerPeriod {
  return {
    organization_id: ORG_ID,
    period_key: "2026-10",
    currency: "USD",
    limit,
    committed,
    updated_at: NOW.toISOString(),
  };
}

export function balances(cop = 2_500_000_000, usd = 12_000_000): Balance[] {
  return [
    { organization_id: ORG_ID, currency: "COP", available: cop, updated_at: NOW.toISOString() },
    { organization_id: ORG_ID, currency: "USD", available: usd, updated_at: NOW.toISOString() },
  ];
}

export function priorPaid(daysAgo: number, amount = 480_000_000): PriorInvoice {
  return {
    invoice_id: `prev-${String(daysAgo)}`,
    vendor_id: VENDOR_ID,
    document_hash: "e".repeat(64),
    semantic_key: `NUBE ANDINA SAS|F${String(2000 + daysAgo)}|${String(amount)}|COP`,
    amount: { amount, currency: "COP" },
    received_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    outcome: "pagar",
  };
}

export const matched: PayeeMatch = { kind: "matched", vendor, by: "exact" };

export function baseContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    extraction: baseExtraction(),
    verification: cleanVerification,
    payee: matched,
    policy: basePolicy(),
    fx,
    ledger: ledger(),
    balances: balances(),
    prior: [priorPaid(40), priorPaid(70), priorPaid(100)],
    invoice_id: INVOICE_ID,
    document_hash: DOC_HASH,
    semantic_key: SEMANTIC_KEY,
    now: NOW,
    ...overrides,
  };
}
