import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  AgreementSchema,
  BankAccountSchema,
  CURRENCIES,
  CountrySchema,
  CurrencySchema,
  FxTableSchema,
  VerificationSchema,
  defaultPolicy,
  money,
  paymentOrderFor,
  periodKey,
  semanticKey,
  sha256Hex,
  toUsd,
  type Currency,
  type Decision,
  type InvoiceStatus,
  type Organization,
  type PolicyVersion,
  type UlidGenerator,
  type Vendor,
  type Verdict,
} from "@/src/domain";

import { withWriteTransaction, type Database } from "./client";
import {
  appendEvent,
  appendPolicyVersion,
  createOrganization,
  ensureLedgerPeriod,
  getPolicyVersion,
  insertDecision,
  insertInvoice,
  insertVendor,
  nextReference,
  reserveBudget,
  setBalance,
} from "./repositories";

/**
 * Semilla: empresa ficticia, saldos, vendors y política v1. Todos los datos son inventados.
 * La misma función sirve para la base local y para la copia por visitante de la demo:
 * cada llamada genera ids nuevos, así dos copias nunca comparten identificadores.
 */

const CompanySeedSchema = z.strictObject({
  name: z.string().min(1),
  reference_prefix: z.string().regex(/^[A-Z]{2,4}$/),
  source_account_id: z.string().min(1),
  approvers: z.array(z.string().min(1)).min(1),
  fx: FxTableSchema,
  balances: z.record(CurrencySchema, z.number().int().min(0)),
});

const VendorSeedSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  tax_id: z.string().min(1).optional(),
  country: CountrySchema,
  account: BankAccountSchema,
  verification: VerificationSchema,
  agreement: AgreementSchema,
});

export type SeedData = {
  readonly company: z.infer<typeof CompanySeedSchema>;
  readonly vendors: readonly z.infer<typeof VendorSeedSchema>[];
};

export const SEED_DIR = path.join(process.cwd(), "data", "seed");

/** Lee y valida los archivos de `data/seed`. */
export async function loadSeedData(dir: string = SEED_DIR): Promise<SeedData> {
  const [companyText, vendorsText] = await Promise.all([
    readFile(path.join(dir, "empresa.json"), "utf8"),
    readFile(path.join(dir, "vendors.json"), "utf8"),
  ]);
  const company = CompanySeedSchema.parse(JSON.parse(companyText));
  const vendors = z.array(VendorSeedSchema).min(1).parse(JSON.parse(vendorsText));
  const keys = new Set(vendors.map((v) => v.key));
  if (keys.size !== vendors.length) throw new Error("Claves de vendor repetidas en la semilla");
  return { company, vendors };
}

export type SeedOptions = {
  readonly data: SeedData;
  readonly newId: UlidGenerator;
  readonly now: () => Date;
  readonly systemHardCapUsdCents: number;
  /** Id del visitante de la demo, o null para la base local. */
  readonly visitorId: string | null;
  readonly signedBy?: string;
};

export type SeedResult = {
  readonly organization: Organization;
  readonly vendors: readonly Vendor[];
  /** Los mismos vendors, por la clave que usan la semilla y el dataset. */
  readonly vendorsByKey: ReadonlyMap<string, Vendor>;
  readonly policyVersionId: string;
};

/** Crea una empresa completa en una sola transacción. */
export async function seedOrganization(db: Database, options: SeedOptions): Promise<SeedResult> {
  const { data, newId, systemHardCapUsdCents, visitorId } = options;
  const nowIso = options.now().toISOString();
  const [firstApprover] = data.company.approvers;
  const signedBy = options.signedBy ?? firstApprover;
  if (signedBy === undefined) throw new Error("La semilla necesita al menos un aprobador");

  return db.transaction(async (tx) => {
    const organization: Organization = {
      id: newId(),
      name: data.company.name,
      reference_prefix: data.company.reference_prefix,
      base_currency: "USD",
      fx: data.company.fx,
      demo_visitor_id: visitorId,
      created_at: nowIso,
    };
    await createOrganization(tx, organization);

    for (const currency of CURRENCIES) {
      await setBalance(tx, {
        organization_id: organization.id,
        currency,
        available: data.company.balances[currency],
        updated_at: nowIso,
      });
    }

    const vendors: Vendor[] = [];
    const vendorsByKey = new Map<string, Vendor>();
    for (const seed of data.vendors) {
      const vendor: Vendor = {
        id: newId(),
        organization_id: organization.id,
        name: seed.name,
        aliases: seed.aliases,
        ...(seed.tax_id === undefined ? {} : { tax_id: seed.tax_id }),
        country: seed.country,
        account: seed.account,
        verification: seed.verification,
        agreement: seed.agreement,
        created_at: nowIso,
      };
      await insertVendor(tx, vendor);
      vendors.push(vendor);
      vendorsByKey.set(seed.key, vendor);
    }

    const base = defaultPolicy({
      systemHardCapUsdCents,
      sourceAccountId: data.company.source_account_id,
      approvers: data.company.approvers,
    });
    const policy = { ...base, allowed_payees: vendors.map((v) => v.id) };
    const version = await appendPolicyVersion(
      tx,
      organization.id,
      { content: policy, signedBy, signedAt: nowIso, note: "Política inicial" },
      newId,
    );

    await appendEvent(tx, {
      id: newId(),
      organization_id: organization.id,
      type: "policy.saved",
      actor: { kind: "humano", name: signedBy },
      invoice_id: null,
      decision_id: null,
      data: { version: version.version, content_hash: version.content_hash, seed: true },
      trace_id: `seed-${organization.id}`,
      occurred_at: nowIso,
    });

    return { organization, vendors, vendorsByKey, policyVersionId: version.id };
  });
}

// ---------------------------------------------------------------------------
// Historial: facturas de meses anteriores ya decididas, y lo comprometido del mes en curso.
// Sin esto, las reglas de historial (primer pago, monto atípico, duplicados) no tendrían
// con qué comparar y el presupuesto del mes arrancaría vacío.
// ---------------------------------------------------------------------------

/** Factura anterior tal como la describe `data/dataset/historial.json`. */
export type HistorySeedEntry = {
  readonly vendor_key: string;
  readonly invoice_number: string;
  readonly received_at: string;
  readonly currency: Currency;
  readonly amount: number;
  readonly verdict: Verdict;
  readonly resolution: "aprobada" | "rechazada" | null;
};

export type HistorySeedOptions = {
  readonly organization: Organization;
  readonly vendorsByKey: ReadonlyMap<string, Vendor>;
  readonly policyVersion: PolicyVersion;
  readonly entries: readonly HistorySeedEntry[];
  /** Presupuesto del periodo en curso ya comprometido, en centavos de USD. */
  readonly committedUsdCents: number;
  /** Día de negocio (`YYYY-MM-DD`) que fija el periodo del presupuesto. */
  readonly today: string;
  readonly newId: UlidGenerator;
};

/** Estado final de una factura del historial según su veredicto y su resolución humana. */
function historyStatus(entry: HistorySeedEntry): InvoiceStatus {
  if (entry.resolution !== null) return entry.resolution;
  return entry.verdict === "escalar" ? "esperando_aprobacion" : "decidida";
}

/**
 * Siembra el historial en una sola transacción: por cada entrada, una factura en su estado
 * final, su decisión y su evento; después, el periodo de presupuesto con lo ya comprometido.
 * Las facturas del historial no tienen archivo: su hash es sintético y su archivo queda
 * `pendiente`. Sus decisiones no llevan hallazgos y su explicación lo dice.
 */
export async function seedHistory(db: Database, options: HistorySeedOptions): Promise<void> {
  const { organization, policyVersion, newId } = options;
  const policy = policyVersion.content;
  await withWriteTransaction(db, async (tx) => {
    for (const [i, entry] of options.entries.entries()) {
      const vendor = options.vendorsByKey.get(entry.vendor_key);
      if (!vendor)
        throw new Error(`El historial nombra un vendor inexistente: ${entry.vendor_key}`);
      const receivedAt = entry.received_at;
      const receivedDay = receivedAt.slice(0, 10);
      const amount = money(entry.amount, entry.currency);
      const reference = await nextReference(
        tx,
        organization.id,
        organization.reference_prefix,
        new Date(receivedAt),
      );
      const documentHash = sha256Hex(`historial:${organization.id}:${String(i)}`);
      const invoiceId = newId();
      await insertInvoice(tx, {
        id: invoiceId,
        organization_id: organization.id,
        reference,
        channel: "batch",
        receipt_key: `seed:historial-${String(i)}`,
        source_kind: "pdf",
        document_hash: documentHash,
        file_key: `${organization.id}/historial/${String(i)}`,
        file_state: "pendiente",
        original_name: `historial-${entry.invoice_number}`,
        mime_type: "application/pdf",
        size_bytes: 0,
        page_keys: [],
        text: null,
        semantic_key: semanticKey({
          payeeName: vendor.name,
          invoiceNumber: entry.invoice_number,
          amount: entry.amount,
          currency: entry.currency,
        }),
        status: historyStatus(entry),
        approval_expires_at: null,
        channel_meta: {},
        received_at: receivedAt,
        updated_at: receivedAt,
      });
      const paid = entry.verdict === "pagar";
      const decision: Decision = {
        id: newId(),
        organization_id: organization.id,
        invoice_id: invoiceId,
        verdict: entry.verdict,
        findings: [],
        explanation: `Decisión del historial sembrado: ${entry.verdict}${
          entry.resolution === null ? "" : `, ${entry.resolution} por una persona`
        }.`,
        summary: null,
        scheduled_for: paid ? receivedDay : null,
        payment_order: paid
          ? paymentOrderFor({ vendor, amount, policy, scheduledFor: receivedDay, reference })
          : null,
        amount,
        amount_usd: { amount: toUsd(amount, organization.fx).amount, currency: "USD" },
        vendor_id: vendor.id,
        policy_version_id: policyVersion.id,
        policy_hash: policyVersion.content_hash,
        document_hash: documentHash,
        extraction_hash: null,
        field_sources: {},
        previous_decision_id: null,
        dry_run: false,
        actor: { kind: "agente" },
        cost_usd_micros: 0,
        latency_ms: 0,
        decided_at: receivedAt,
      };
      await insertDecision(tx, decision);
      await appendEvent(tx, {
        id: newId(),
        organization_id: organization.id,
        type: entry.verdict === "escalar" ? "invoice.escalated" : "invoice.decided",
        actor: { kind: "agente" },
        invoice_id: invoiceId,
        decision_id: decision.id,
        data: { verdict: entry.verdict, resolution: entry.resolution, seed: true },
        trace_id: `seed-${organization.id}`,
        occurred_at: receivedAt,
      });
    }

    const { budget } = policy.limits;
    const period = periodKey(new Date(`${options.today}T00:00:00.000Z`), budget.period);
    const nowIso = `${options.today}T00:00:00.000Z`;
    await ensureLedgerPeriod(tx, organization.id, period, budget.currency, budget.amount, nowIso);
    if (options.committedUsdCents > 0) {
      await reserveBudget(
        tx,
        organization.id,
        period,
        budget.currency,
        options.committedUsdCents,
        nowIso,
      );
    }
  });
}

export type DatasetSeedOptions = SeedOptions &
  Pick<HistorySeedOptions, "committedUsdCents" | "today"> & {
    readonly history: readonly HistorySeedEntry[];
  };

/**
 * Empresa lista para el dataset: semilla completa más historial y presupuesto comprometido.
 * La usan la base local, las pruebas del caso de uso y la copia de cada visitante de la demo.
 */
export async function seedDatasetOrganization(
  db: Database,
  options: DatasetSeedOptions,
): Promise<SeedResult & { readonly policyVersion: PolicyVersion }> {
  const seeded = await seedOrganization(db, options);
  const policyVersion = await getPolicyVersion(db, seeded.organization.id, seeded.policyVersionId);
  await seedHistory(db, {
    organization: seeded.organization,
    vendorsByKey: seeded.vendorsByKey,
    policyVersion,
    entries: options.history,
    committedUsdCents: options.committedUsdCents,
    today: options.today,
    newId: options.newId,
  });
  return { ...seeded, policyVersion };
}
