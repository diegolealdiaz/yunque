"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { APPROVER_COOKIE, VISITOR_COOKIE_MAX_AGE_S, signApprover } from "@/src/session";
import { loadCurrentPolicy } from "@/src/usecases";

import { appContext } from "../_data/context";

/**
 * Elige quién resuelve y firma en esta demo, de la lista de aprobadores de la política
 * vigente (D16). Un nombre fuera de la lista se ignora. La elección queda en una cookie
 * firmada que cada acción vuelve a verificar contra la política.
 */
export async function chooseApprover(form: FormData): Promise<void> {
  const { config, db, organization } = await appContext();
  const name = form.get("approver");
  const policy = await loadCurrentPolicy(db, organization.id);
  if (typeof name !== "string" || !policy?.content.protected.approvers.includes(name)) return;
  (await cookies()).set(APPROVER_COOKIE, signApprover(name, config.secrets.session), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.env === "production",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_S,
  });
  // Solo rutas propias: el valor del formulario no decide a dónde se revalida fuera de la app.
  const path = form.get("path");
  revalidatePath(typeof path === "string" && /^\/[a-z0-9/_-]*$/i.test(path) ? path : "/");
}
