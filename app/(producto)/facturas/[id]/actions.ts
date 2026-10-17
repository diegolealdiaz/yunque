"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { getCurrentPolicy } from "@/src/db/repositories";
import {
  APPROVER_COOKIE,
  VISITOR_COOKIE_MAX_AGE_S,
  signApprover,
  verifyApprover,
} from "@/src/session";
import {
  ApprovalError,
  approveEscalation,
  currentBusinessDate,
  rejectEscalation,
  type ResolutionDeps,
} from "@/src/usecases";
import { createUlidGenerator } from "@/src/domain";

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
  if (error instanceof ApprovalError)
    return { ok: false, message: error.message, action: error.action };
  throw error;
}

/** Elige quién aprueba en esta demo, de la lista de aprobadores de la política vigente. */
export async function chooseApprover(form: FormData): Promise<void> {
  const { config, db, organization } = await appContext();
  const name = field(form, "approver");
  const policy = await getCurrentPolicy(db, organization.id);
  if (!policy?.content.protected.approvers.includes(name)) return;
  (await cookies()).set(APPROVER_COOKIE, signApprover(name, config.secrets.session), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.env === "production",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_S,
  });
  revalidatePath(`/facturas/${field(form, "invoiceId")}`);
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
