import { withWriteTransaction, type Executor } from "@/src/db/client";
import {
  appendEvent,
  appendPolicyVersion,
  getCurrentPolicy,
  getInvoice,
  getLatestDecision,
  getLatestExtraction,
  insertVendor,
  listEvents,
  listVendors,
} from "@/src/db/repositories";
import {
  CURRENCY_SPECS,
  VendorSchema,
  isPresent,
  isSupportedCurrency,
  maskAccount,
  parsePolicy,
  type Country,
  type Currency,
  type Decision,
  type Rail,
  type Ulid,
  type Vendor,
} from "@/src/domain";
import { comparableName, comparableTaxId, resolvePayee } from "@/src/resolve";

import { reevaluateWithCurrentPolicy } from "./correct-invoice";
import { auditEvent, type DecideDeps } from "./decide";
import { UseCaseError } from "./errors";

/**
 * Registro de un proveedor desde la factura que lo trae. El caso más común en cuentas por
 * pagar: llega un cobro de alguien que no está registrado, el agente no lo paga y una persona
 * decide. Sin esto, lo único posible era rechazar.
 *
 * - Los datos se prellenan con lo que leyó el agente; la persona los revisa contra el
 *   documento y confirma que los verificó con el proveedor por otro canal.
 * - Con la doble firma encendida, el beneficiario queda permitido pero sin verificar: la
 *   regla fija "beneficiario sin verificar" escala, y otra persona lo verifica al aprobar la
 *   factura. Sin doble firma queda verificado por quien lo registra.
 * - No se crea un duplicado: ni con la identificación o la cuenta de uno registrado, ni con
 *   su mismo nombre. Un nombre parecido exige confirmar que es otra empresa.
 * - Queda en la bitácora quién lo registró y con qué cuenta, y la factura se reevalúa.
 */

/** Lo que se prellena en el formulario de registro. */
export type VendorDraft = {
  readonly name: string;
  readonly taxId: string | null;
  readonly currency: Currency;
  readonly country: Country;
  /** Rutas que sirven para la moneda; la primera es la sugerida. */
  readonly rails: readonly Rail[];
  readonly accountNumber: string;
  readonly holderName: string;
  /** Un beneficiario registrado con nombre parecido: hay que confirmar que es otra empresa. */
  readonly lookalike: string | null;
  /** Con la doble firma, otra persona lo verifica al aprobar la factura. */
  readonly fourEyes: boolean;
};

/** Solo letras y dígitos: la forma en que se guarda un número de cuenta. */
const accountDigits = (text: string) => text.replace(/[^A-Za-z0-9]/g, "");

type Onboardable = {
  readonly decision: Decision;
  readonly currency: Currency;
  readonly readName: string;
  readonly readTaxId: string | null;
  readonly readAccount: string;
  readonly readHolder: string | null;
};

/** La factura admite el alta: escalada, sin beneficiario reconocido y con moneda pagable. */
async function onboardable(
  exec: Executor,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<Onboardable | null> {
  const invoice = await getInvoice(exec, organizationId, invoiceId);
  if (invoice.status !== "esperando_aprobacion") return null;
  const [decision, stored] = await Promise.all([
    getLatestDecision(exec, organizationId, invoiceId),
    getLatestExtraction(exec, organizationId, invoiceId),
  ]);
  if (decision?.verdict !== "escalar" || decision.vendor_id !== null) return null;
  const extraction = stored?.record.extraction;
  if (extraction?.kind !== "invoice") return null;
  const { fields } = extraction;
  if (!isPresent(fields.currency) || !isSupportedCurrency(fields.currency.value)) return null;
  return {
    decision,
    currency: fields.currency.value,
    readName: fields.payee_name.value,
    readTaxId: isPresent(fields.payee_tax_id) ? fields.payee_tax_id.value : null,
    readAccount: isPresent(fields.bank_account) ? accountDigits(fields.bank_account.value) : "",
    readHolder: isPresent(fields.bank_holder) ? fields.bank_holder.value : null,
  };
}

/** El formulario de registro prellenado, o null si la factura no lo admite. */
export async function vendorDraftFor(
  deps: Pick<DecideDeps, "db">,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<VendorDraft | null> {
  const found = await onboardable(deps.db, organizationId, invoiceId);
  if (!found) return null;
  const [vendors, policy] = await Promise.all([
    listVendors(deps.db, organizationId),
    getCurrentPolicy(deps.db, organizationId),
  ]);
  const spec = CURRENCY_SPECS[found.currency];
  const match = resolvePayee(
    {
      payee_name: {
        value: found.readName,
        evidence: { literal: "", quote: "", page: null },
        confidence: 1,
        source: "humano",
      },
      payee_tax_id: { value: null, reason: "alta" },
    },
    vendors,
  );
  return {
    name: found.readName,
    taxId: found.readTaxId,
    currency: found.currency,
    country: spec.country,
    rails: spec.rails,
    accountNumber: found.readAccount,
    holderName: found.readHolder ?? found.readName,
    lookalike: match.kind === "unknown" && match.closest ? match.closest.vendor.name : null,
    fourEyes: policy?.content.controls.four_eyes ?? true,
  };
}

export type OnboardInput = {
  readonly organizationId: Ulid;
  readonly invoiceId: Ulid;
  /** Aprobador de la cookie verificada. */
  readonly actor: string | null;
  readonly name: string;
  readonly taxId: string | null;
  readonly rail: string;
  readonly accountNumber: string;
  readonly holderName: string;
  /** Confirmó los datos con el proveedor por un canal distinto a la factura. */
  readonly confirmedOutOfBand: boolean;
  /** Confirmó que no es el beneficiario registrado de nombre parecido. */
  readonly notTheLookalike: boolean;
};

const invalid = (message: string, action: string) =>
  new UseCaseError("invalid_vendor", message, { action });

/**
 * Registra al proveedor de la factura, lo agrega a la lista de permitidos en una versión
 * nueva de la política y reevalúa la factura con él.
 */
export async function onboardVendor(
  deps: DecideDeps,
  input: OnboardInput,
): Promise<{ readonly vendor: Vendor; readonly decision: Decision }> {
  if (!input.confirmedOutOfBand) {
    throw invalid(
      "Falta confirmar que verificaste los datos con el proveedor",
      "Confírmalos por teléfono o por un canal que ya conoces, no por la factura, y marca la casilla",
    );
  }
  const at = deps.now().toISOString();
  const vendor = await withWriteTransaction(deps.db, async (tx) => {
    const current = await getCurrentPolicy(tx, input.organizationId);
    if (!current)
      throw new UseCaseError("policy_missing", "La empresa no tiene política vigente", {
        action: "Configura la política en Reglas",
      });
    const actor = input.actor;
    if (actor === null || !current.content.protected.approvers.includes(actor)) {
      throw new UseCaseError(
        "not_authorized",
        "Quien registra al proveedor no está en la lista de aprobadores",
        { action: "Elige un aprobador de la lista" },
      );
    }
    const found = await onboardable(tx, input.organizationId, input.invoiceId);
    if (!found) {
      throw new UseCaseError(
        "not_onboardable",
        "Esta factura ya no espera el registro de su proveedor",
        { action: "Recarga la página para ver cómo quedó" },
      );
    }
    const spec = CURRENCY_SPECS[found.currency];
    const rail = spec.rails.find((r) => r === input.rail);
    if (!rail) {
      throw invalid(
        "Esa forma de pago no sirve para la moneda de la factura",
        "Elige una de la lista",
      );
    }
    const name = input.name.trim();
    const taxId = input.taxId?.trim() || null;
    const account = accountDigits(input.accountNumber);

    const vendors = await listVendors(tx, input.organizationId);
    const sameName = vendors.find((v) => comparableName(v.name) === comparableName(name));
    const sameTax =
      taxId === null
        ? undefined
        : vendors.find(
            (v) => v.tax_id !== undefined && comparableTaxId(v.tax_id) === comparableTaxId(taxId),
          );
    const sameAccount = vendors.find((v) => v.account.account_number === account);
    const existing = sameName ?? sameTax ?? sameAccount;
    if (existing) {
      throw new UseCaseError(
        "vendor_exists",
        `Ya está registrado «${existing.name}» con ${existing === sameAccount && existing !== sameName ? "esa misma cuenta" : existing === sameTax && existing !== sameName ? "esa identificación" : "ese nombre"}`,
        {
          action:
            "Si es el mismo proveedor, revisa los datos de la factura; si la cuenta coincide con la de otro, puede ser un fraude: no lo registres",
        },
      );
    }
    const match = resolvePayee(
      {
        payee_name: {
          value: name,
          evidence: { literal: "", quote: "", page: null },
          confidence: 1,
          source: "humano",
        },
        payee_tax_id: { value: null, reason: "alta" },
      },
      vendors,
    );
    if (match.kind === "unknown" && match.closest && !input.notTheLookalike) {
      throw invalid(
        `El nombre se parece a «${match.closest.vendor.name}», que ya está registrado`,
        "Confirma que es otra empresa: un nombre casi igual es una forma común de fraude",
      );
    }

    const fourEyes = current.content.controls.four_eyes;
    const parsed = VendorSchema.safeParse({
      id: deps.newId(),
      organization_id: input.organizationId,
      name,
      aliases:
        comparableName(found.readName) === comparableName(name)
          ? []
          : [found.readName.slice(0, 200)],
      ...(taxId ? { tax_id: taxId } : {}),
      country: spec.country,
      account: {
        country: spec.country,
        currency: found.currency,
        rail,
        account_number: account,
        holder_name: input.holderName.trim(),
        ...(taxId ? { holder_tax_id: taxId } : {}),
      },
      verification: fourEyes ? { status: "pendiente" } : { status: "verificado", by: actor, at },
      agreement: { kind: "none" },
      created_at: at,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw invalid(
        `Un dato del beneficiario no es válido${issue ? ` (${issue.path.map(String).join(".")})` : ""}`,
        "La cuenta lleva solo letras y dígitos, de 4 a 34; el nombre y el titular no pueden quedar vacíos",
      );
    }
    const vendor = parsed.data;
    await insertVendor(tx, vendor);
    const saved = await appendPolicyVersion(
      tx,
      input.organizationId,
      {
        content: parsePolicy({
          ...current.content,
          allowed_payees: [...current.content.allowed_payees, vendor.id],
        }),
        signedBy: actor,
        signedAt: at,
        note: `Registro de proveedor: ${vendor.name}`.slice(0, 500),
      },
      deps.newId,
    );
    const invoice = await getInvoice(tx, input.organizationId, input.invoiceId);
    const traceId = `tr-${deps.newId()}`;
    const data = {
      vendor_id: vendor.id,
      name: vendor.name,
      account: maskAccount(vendor.account.account_number),
      rail: vendor.account.rail,
      verified: !fourEyes,
      policy_version: saved.version,
    };
    await appendEvent(
      tx,
      auditEvent(deps, {
        type: "vendor.created",
        actor: { kind: "humano", name: actor },
        invoice,
        data,
        traceId,
        at,
      }),
    );
    if (!fourEyes) {
      await appendEvent(
        tx,
        auditEvent(deps, {
          type: "vendor.verified",
          actor: { kind: "humano", name: actor },
          invoice,
          data: { vendor_id: vendor.id, name: vendor.name },
          traceId,
          at,
        }),
      );
    }
    return vendor;
  });
  const result = await reevaluateWithCurrentPolicy(deps, {
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    actor: input.actor,
  });
  return { vendor, decision: result.decision };
}

/** Quién registró a un proveedor que espera verificación, para el panel de la factura. */
export type PendingVendor = {
  readonly name: string;
  readonly registeredBy: string | null;
  readonly fourEyes: boolean;
};

/**
 * El proveedor de la decisión vigente, si todavía no está verificado: quién lo registró y si
 * la doble firma pide que lo verifique otra persona. Null si no hay nada que verificar.
 */
export async function pendingVendorFor(
  deps: Pick<DecideDeps, "db">,
  organizationId: Ulid,
  invoiceId: Ulid,
): Promise<PendingVendor | null> {
  const decision = await getLatestDecision(deps.db, organizationId, invoiceId);
  if (!decision?.vendor_id) return null;
  const vendors = await listVendors(deps.db, organizationId);
  const vendor = vendors.find((v) => v.id === decision.vendor_id);
  if (!vendor || vendor.verification.status !== "pendiente") return null;
  const [created, policy] = await Promise.all([
    listEvents(deps.db, organizationId, { type: "vendor.created", limit: 500 }),
    getCurrentPolicy(deps.db, organizationId),
  ]);
  const actor = created.find((e) => e.data["vendor_id"] === vendor.id)?.actor;
  return {
    name: vendor.name,
    registeredBy: actor?.kind === "humano" ? actor.name : null,
    fourEyes: policy?.content.controls.four_eyes ?? true,
  };
}
