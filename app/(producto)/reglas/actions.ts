"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { getCurrentPolicy } from "@/src/db/repositories";
import { PolicyError, type Controls, type FindingCode, type Verdict } from "@/src/domain";
import { APPROVER_COOKIE, verifyApprover } from "@/src/session";
import {
  CorrectionError,
  candidateFromYaml,
  changeControls,
  previewPolicyChange,
  savePolicy,
} from "@/src/usecases";

import { deliverNotificationsAfterResponse } from "../../_data/notify";
import { processingContext } from "../../_data/process";

/**
 * Acciones de la pantalla de Reglas. El YAML del editor es no confiable: se valida con el
 * esquema estricto de la parte editable, y las claves protegidas y los controles se copian
 * de la política vigente, nunca del editor. Firma quien eligió "Resuelves como".
 */

export type PreviewState =
  | null
  | { readonly ok: false; readonly problems: readonly string[] }
  | {
      readonly ok: true;
      readonly evaluated: number;
      readonly skipped: number;
      readonly changes: readonly {
        readonly invoiceId: string;
        readonly reference: string;
        readonly before: { readonly verdict: Verdict; readonly rule: FindingCode | null };
        readonly after: { readonly verdict: Verdict; readonly rule: FindingCode | null };
      }[];
    };

export type SaveState = null | {
  readonly ok: boolean;
  readonly message: string;
  readonly action: string | null;
};

async function context() {
  const ctx = await processingContext();
  const approver = verifyApprover(
    (await cookies()).get(APPROVER_COOKIE)?.value,
    ctx.config.secrets.session,
  );
  const current = await getCurrentPolicy(ctx.db, ctx.organization.id);
  if (!current) throw new PolicyError(["La empresa no tiene política vigente"]);
  return { ...ctx, approver, current };
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function previewAction(
  _previous: PreviewState,
  form: FormData,
): Promise<PreviewState> {
  const { deps, organization, current } = await context();
  try {
    const candidate = candidateFromYaml(current.content, text(form, "yaml"));
    const preview = await previewPolicyChange(deps, { organizationId: organization.id, candidate });
    return { ok: true, ...preview };
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, problems: error.problems };
    throw error;
  }
}

export async function saveAction(_previous: SaveState, form: FormData): Promise<SaveState> {
  const { deps, organization, current, approver } = await context();
  try {
    const candidate = candidateFromYaml(current.content, text(form, "yaml"));
    const result = await savePolicy(deps, {
      organizationId: organization.id,
      candidate,
      signedBy: approver,
      note: text(form, "nota").trim() || null,
    });
    for (const path of ["/reglas", "/pendientes", "/facturas"]) revalidatePath(path);
    // El replay decide de nuevo las abiertas: sus avisos se entregan al responder.
    deliverNotificationsAfterResponse(organization.id);
    return {
      ok: true,
      message: `Guardada como v${String(result.version.version)}. Se reevaluaron ${String(result.evaluated - result.skipped)} facturas abiertas y cambiaron ${String(result.changed)}.`,
      action: null,
    };
  } catch (error) {
    if (error instanceof PolicyError) {
      return { ok: false, message: error.problems.join(" · "), action: "Corrige el YAML" };
    }
    if (error instanceof CorrectionError) {
      return { ok: false, message: error.message, action: error.action };
    }
    throw error;
  }
}

const CONTROL_NAMES = ["payments_enabled", "dry_run", "autonomy"] as const;

export async function controlsAction(_previous: SaveState, form: FormData): Promise<SaveState> {
  const { deps, organization, approver } = await context();
  const name = CONTROL_NAMES.find((n) => n === text(form, "control"));
  const on = text(form, "value") === "on";
  if (!name)
    return { ok: false, message: "Ese interruptor no existe.", action: "Recarga la página." };
  const patch: Partial<Controls> =
    name === "autonomy" ? { autonomy: on ? "decidir" : "recomendar" } : { [name]: on };
  try {
    const version = await changeControls(deps, {
      organizationId: organization.id,
      controls: patch,
      signedBy: approver,
    });
    for (const path of ["/reglas", "/pendientes", "/facturas"]) revalidatePath(path);
    return { ok: true, message: `Guardado como v${String(version.version)}.`, action: null };
  } catch (error) {
    if (error instanceof CorrectionError) {
      return { ok: false, message: error.message, action: error.action };
    }
    throw error;
  }
}
