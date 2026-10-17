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
import { decidingFinding } from "@/src/engine";
import { FIELD_LABEL, RULE_SHORT_LABEL, VERDICT_LABEL } from "@/src/ui/labels";
import {
  ApprovalError,
  CorrectionError,
  approveEscalation,
  correctAndReevaluate,
  currentBusinessDate,
  reevaluateWithCurrentPolicy,
  rejectEscalation,
  type ResolutionDeps,
} from "@/src/usecases";

import { appContext } from "../../../_data/context";

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
  revalidatePath(`/facturas/${invoiceId}`);
  revalidatePath("/pendientes");
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
  revalidatePath(`/facturas/${invoiceId}`);
  revalidatePath("/pendientes");
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
    revalidatePath(`/facturas/${invoiceId}`);
    revalidatePath("/pendientes");
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
    revalidatePath(`/facturas/${invoiceId}`);
    revalidatePath("/pendientes");
    return {
      ok: true,
      message: `Reevaluada con la política vigente. ${outcome(result.decision)}`,
      action: null,
    };
  } catch (error) {
    return failure(error);
  }
}
