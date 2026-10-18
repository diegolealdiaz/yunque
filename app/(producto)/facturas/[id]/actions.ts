"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { APPROVER_COOKIE, verifyApprover } from "@/src/session";
import {
  ExtractedFieldNameSchema,
  createUlidGenerator,
  type Decision,
  type ExtractedFieldName,
} from "@/src/domain";
import { FIELD_LABEL, RULE_SHORT_LABEL, VERDICT_LABEL } from "@/src/ui/labels";
import {
  ApprovalError,
  CorrectionError,
  UseCaseError,
  approveEscalation,
  correctAndReevaluate,
  currentBusinessDate,
  onboardVendor,
  rateExplanation,
  decidingFinding,
  reevaluateWithCurrentPolicy,
  rejectEscalation,
  type ResolutionDeps,
} from "@/src/usecases";

import { appContext } from "../../../_data/context";
import { deliverNotificationsAfterResponse } from "../../../_data/notify";

/**
 * Acciones de la persona sobre una escalada. Todo lo que llega del formulario se trata como
 * no confiable: la empresa sale de la cookie verificada, el aprobador de su cookie firmada,
 * y el contenido a aprobar se verifica contra su firma y contra la base en el caso de uso.
 */

export type ResolutionState = {
  readonly ok: boolean;
  readonly message: string;
  readonly action: string | null;
} | null;

const newId = createUlidGenerator();

/** Tras una decisión nueva: refrescar las pantallas que la muestran y entregar sus avisos. */
function afterDecision(organizationId: string, invoiceId: string): void {
  revalidatePath(`/facturas/${invoiceId}`);
  revalidatePath("/pendientes");
  deliverNotificationsAfterResponse(organizationId);
}

async function resolutionDeps(): Promise<{
  deps: ResolutionDeps;
  organizationId: string;
  approver: string | null;
}> {
  const { config, db, organization } = await appContext();
  const now = new Date();
  const jar = await cookies();
  return {
    organizationId: organization.id,
    approver: verifyApprover(jar.get(APPROVER_COOKIE)?.value, config.secrets.session),
    deps: {
      db,
      newId,
      now: () => new Date(),
      timeZone: config.displayTimeZone,
      businessDate: currentBusinessDate(
        { demo: config.demo.enabled, timeZone: config.displayTimeZone },
        now,
      ),
      signingSecret: config.secrets.approvalSigning,
    },
  };
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** El contenido firmado viaja como JSON; si no se puede leer, cuenta como firma inválida. */
function payloadOf(form: FormData): unknown {
  try {
    return JSON.parse(field(form, "payload"));
  } catch {
    return null;
  }
}

function failure(error: unknown): ResolutionState {
  if (error instanceof ApprovalError) {
    return { ok: false, message: error.message, action: error.action };
  }
  if (error instanceof CorrectionError) {
    const where = error.field ? ` (${FIELD_LABEL[error.field]})` : "";
    return { ok: false, message: `${error.message}${where}`, action: error.action };
  }
  if (error instanceof UseCaseError) {
    return { ok: false, message: error.message, action: error.action };
  }
  throw error;
}

/** Cómo quedó la factura después de reevaluar, en una frase. */
function outcome(decision: Decision): string {
  const rule = decidingFinding(decision);
  return `Ahora: ${VERDICT_LABEL[decision.verdict]}${rule ? ` · ${RULE_SHORT_LABEL[rule.code]}` : ""}.`;
}

export async function approveAction(
  _previous: ResolutionState,
  form: FormData,
): Promise<ResolutionState> {
  const { deps, organizationId, approver } = await resolutionDeps();
  const invoiceId = field(form, "invoiceId");
  try {
    await approveEscalation(deps, {
      organizationId,
      invoiceId,
      payload: payloadOf(form),
      signature: field(form, "signature"),
      approver,
      checkedCodes: form.getAll("check").filter((v): v is string => typeof v === "string"),
    });
  } catch (error) {
    return failure(error);
  }
  afterDecision(organizationId, invoiceId);
  return { ok: true, message: "Aprobada. La orden quedó preparada, no ejecutada.", action: null };
}

export async function rejectAction(
  _previous: ResolutionState,
  form: FormData,
): Promise<ResolutionState> {
  const { deps, organizationId, approver } = await resolutionDeps();
  const invoiceId = field(form, "invoiceId");
  try {
    await rejectEscalation(deps, {
      organizationId,
      invoiceId,
      payload: payloadOf(form),
      signature: field(form, "signature"),
      approver,
      reason: field(form, "reason"),
    });
  } catch (error) {
    return failure(error);
  }
  afterDecision(organizationId, invoiceId);
  return { ok: true, message: "Rechazada. No se pagará.", action: null };
}

export async function correctAction(
  _previous: ResolutionState,
  form: FormData,
): Promise<ResolutionState> {
  const { deps, organizationId, approver } = await resolutionDeps();
  const invoiceId = field(form, "invoiceId");
  // Solo los campos conocidos: cualquier otra clave del formulario se ignora.
  const submitted: Partial<Record<ExtractedFieldName, string>> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("campo:") || typeof value !== "string") continue;
    const name = ExtractedFieldNameSchema.safeParse(key.slice("campo:".length));
    if (name.success) submitted[name.data] = value;
  }
  const confirmed = form
    .getAll("confirmar")
    .map((v) => ExtractedFieldNameSchema.safeParse(v))
    .flatMap((r) => (r.success ? [r.data] : []));
  try {
    const result = await correctAndReevaluate(deps, {
      organizationId,
      invoiceId,
      actor: approver,
      submitted,
      confirmed,
    });
    afterDecision(organizationId, invoiceId);
    return {
      ok: true,
      message: `Corregida y reevaluada. ${outcome(result.decision)}`,
      action: null,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function reevaluateAction(
  _previous: ResolutionState,
  form: FormData,
): Promise<ResolutionState> {
  const { deps, organizationId, approver } = await resolutionDeps();
  const invoiceId = field(form, "invoiceId");
  try {
    const result = await reevaluateWithCurrentPolicy(deps, {
      organizationId,
      invoiceId,
      actor: approver,
    });
    afterDecision(organizationId, invoiceId);
    return {
      ok: true,
      message: `Reevaluada con la política vigente. ${outcome(result.decision)}`,
      action: null,
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * "¿Fue clara la explicación?": cualquiera que mire la decisión puede opinar, firme o no. Con
 * aprobador elegido opina con su nombre; sin él, como visitante de la demo.
 */
export async function rateExplanationAction(
  _previous: ResolutionState,
  form: FormData,
): Promise<ResolutionState> {
  const { organizationId, approver } = await resolutionDeps();
  const { db } = await appContext();
  const invoiceId = field(form, "invoiceId");
  const comment = field(form, "comment").trim();
  try {
    await rateExplanation(db, {
      organizationId,
      invoiceId,
      decisionId: field(form, "decisionId"),
      rating: { clear: field(form, "clear") === "si", ...(comment ? { comment } : {}) },
      actor: { kind: "humano", name: approver ?? "Visitante de la demo" },
      newId,
      now: new Date(),
    });
    revalidatePath(`/facturas/${invoiceId}`);
    return { ok: true, message: "Gracias. Tu opinión quedó en la bitácora.", action: null };
  } catch (error) {
    return failure(error);
  }
}

/** Registra al proveedor de la factura y la reevalúa con él. */
export async function onboardAction(
  _previous: ResolutionState,
  form: FormData,
): Promise<ResolutionState> {
  const { deps, organizationId, approver } = await resolutionDeps();
  const invoiceId = field(form, "invoiceId");
  try {
    const { vendor, decision } = await onboardVendor(deps, {
      organizationId,
      invoiceId,
      actor: approver,
      name: field(form, "nombre"),
      taxId: field(form, "identificacion") || null,
      rail: field(form, "ruta"),
      accountNumber: field(form, "cuenta"),
      holderName: field(form, "titular"),
      confirmedOutOfBand: form.get("confirmado") === "on",
      notTheLookalike: form.get("otra_empresa") === "on",
    });
    afterDecision(organizationId, invoiceId);
    revalidatePath("/reglas");
    return {
      ok: true,
      message: `${vendor.name} quedó registrado como proveedor. ${outcome(decision)}`,
      action:
        vendor.verification.status === "pendiente"
          ? "Para pagarla, otra persona de la lista la aprueba: al hacerlo verifica al proveedor."
          : "Revisa el checklist y apruébala.",
    };
  } catch (error) {
    return failure(error);
  }
}
