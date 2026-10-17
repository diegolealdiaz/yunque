import { loadDatasetSources, loadGroundTruth, pdfText } from "@/src/dataset";
import { loadSeedData } from "@/src/db/seed";
import {
  defaultPolicy,
  documentHash,
  isSupportedCurrency,
  money,
  semanticKey,
  toUsd,
  type Balance,
  type Currency,
  type Extraction,
  type LedgerPeriod,
  type Verdict,
} from "@/src/domain";
import { evaluate, type Evaluation, type PriorInvoice } from "@/src/engine";
import { detectAll, verifyExtraction } from "@/src/extraction";
import { resolvePayee } from "@/src/resolve";

import { generatedFile, idealExtraction, seedVendors } from "../extraction/helpers";

/**
 * Procesa el dataset completo contra el motor, en el orden del manifiesto, como lo hará el
 * caso de uso: un Lector ideal (la verdad del manifiesto), el Verificador y el Detector sobre
 * el texto real del PDF generado, el Resolutor contra la semilla, la política de fábrica, y
 * después de cada `pagar` se descuentan el saldo y el presupuesto. Cada factura procesada
 * entra al historial de las siguientes, recibida "hoy".
 */

const ORG_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const HARD_CAP_USD_CENTS = 10_000_000;

export type SimulatedCase = {
  readonly id: string;
  readonly expectedVerdict: Verdict;
  readonly expectedRule: string | null;
  readonly evaluation: Evaluation;
};

/** El hallazgo que explica el veredicto: el primero cuya acción coincide con él. */
export function decidingRule(evaluation: Evaluation): string | null {
  if (evaluation.verdict === "pagar") return null;
  return evaluation.findings.find((f) => f.action === evaluation.verdict)?.code ?? null;
}

export async function simulateDataset(): Promise<{
  readonly cases: readonly SimulatedCase[];
  readonly ledger: LedgerPeriod;
  readonly balances: ReadonlyMap<Currency, number>;
}> {
  const [src, truth, seed, vendorMap] = await Promise.all([
    loadDatasetSources(),
    loadGroundTruth(),
    loadSeedData(),
    seedVendors(),
  ]);
  const vendors = [...vendorMap.values()];
  const now = new Date(`${src.manifest.today}T00:00:00.000Z`);
  const policy = {
    ...defaultPolicy({
      systemHardCapUsdCents: HARD_CAP_USD_CENTS,
      sourceAccountId: seed.company.source_account_id,
      approvers: seed.company.approvers,
    }),
    allowed_payees: vendors.map((v) => v.id),
  };
  const { fx } = seed.company;
  const balances = new Map<Currency, number>();
  for (const [currency, amount] of Object.entries(seed.company.balances)) {
    if (isSupportedCurrency(currency)) balances.set(currency, amount);
  }
  let ledger: LedgerPeriod = {
    organization_id: ORG_ID,
    period_key: src.manifest.today.slice(0, 7),
    currency: "USD",
    limit: policy.limits.budget.amount,
    committed: src.manifest.october_committed_usd_cents,
    updated_at: now.toISOString(),
  };

  const prior: PriorInvoice[] = src.history.map((h, i) => {
    const vendor = vendorMap.get(h.vendor_key);
    if (!vendor) throw new Error(`vendor ${h.vendor_key} ausente`);
    return {
      invoice_id: `historial-${String(i)}`,
      vendor_id: vendor.id,
      document_hash: documentHash(new TextEncoder().encode(`historial-${String(i)}`)),
      semantic_key: semanticKey({
        payeeName: vendor.name,
        invoiceNumber: h.invoice_number,
        amount: h.amount,
        currency: h.currency,
      }),
      amount: money(h.amount, h.currency),
      received_at: h.received_at,
      outcome: h.resolution ?? h.verdict,
    };
  });

  const out: SimulatedCase[] = [];
  for (const c of src.manifest.cases) {
    const template = src.templates.get(c.template);
    const generated = truth.cases.find((t) => t.id === c.id);
    if (!template || !generated) throw new Error(`caso ${c.id} incompleto`);

    // Lo que la ingesta vería: en correo y chat el documento es el adjunto; el PNG no tiene texto.
    const isScan = c.format === "png";
    const documentFile =
      c.format === "email" || c.format === "chat" ? generated.base_file : generated.file;
    if (documentFile === null) throw new Error(`caso ${c.id} sin documento`);
    const documentBytes = await generatedFile(documentFile);
    const text = isScan ? null : await pdfText(documentBytes);
    const channel = c.channel ? [c.channel.subject ?? "", c.channel.body].join("\n") : null;

    const extraction: Extraction =
      c.format === "not_invoice"
        ? { kind: "not_invoice", reason: "comprobante de nómina, no una factura", suspicions: [] }
        : idealExtraction(c, template);
    const verified = verifyExtraction(extraction, text);
    const verification = {
      ...verified.report,
      suspicions: [...verified.report.suspicions, ...detectAll({ document: text ?? "", channel })],
    };
    const payee =
      extraction.kind === "invoice"
        ? resolvePayee(extraction.fields, vendors)
        : ({ kind: "unknown", closest: null } as const);
    const currency = c.document.currency;
    const key = isSupportedCurrency(currency)
      ? semanticKey({
          payeeName: c.document.payee_name,
          invoiceNumber: c.document.invoice_number,
          amount: c.document.total,
          currency,
        })
      : null;
    const hash = documentHash(documentBytes);

    const evaluation = evaluate({
      extraction,
      verification,
      payee,
      policy,
      fx,
      ledger,
      balances: [...balances.entries()].map(([cur, available]): Balance => ({
        organization_id: ORG_ID,
        currency: cur,
        available,
        updated_at: now.toISOString(),
      })),
      prior,
      invoice_id: c.id,
      document_hash: hash,
      semantic_key: key,
      now,
    });

    if (evaluation.verdict === "pagar" && isSupportedCurrency(currency)) {
      const amount = money(c.document.total, currency);
      balances.set(currency, (balances.get(currency) ?? 0) - amount.amount);
      ledger = { ...ledger, committed: ledger.committed + toUsd(amount, fx).amount };
    }
    prior.push({
      invoice_id: c.id,
      vendor_id: payee.kind === "matched" ? payee.vendor.id : null,
      document_hash: hash,
      semantic_key: key,
      amount: isSupportedCurrency(currency) ? money(c.document.total, currency) : null,
      received_at: now.toISOString(),
      outcome: evaluation.verdict,
    });
    out.push({
      id: c.id,
      expectedVerdict: c.expected.verdict,
      expectedRule: c.expected.rule,
      evaluation,
    });
  }
  return { cases: out, ledger, balances };
}
