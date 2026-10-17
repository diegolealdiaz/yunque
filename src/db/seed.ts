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
  type Organization,
  type UlidGenerator,
  type Vendor,
} from "@/src/domain";

import type { Database } from "./client";
import {
  appendEvent,
  appendPolicyVersion,
  createOrganization,
  insertVendor,
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

    return { organization, vendors, policyVersionId: version.id };
  });
}
