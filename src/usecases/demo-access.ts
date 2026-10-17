import type { Database } from "@/src/db/client";
import {
  countAccessAttemptsSince,
  getAccessGrant,
  insertAccessAttempt,
  saveAccessGrant,
  type AccessGrant,
} from "@/src/db/repositories";
import type { Ulid } from "@/src/domain";
import { sameSecret } from "@/src/session";

import { UseCaseError } from "./errors";

/**
 * Acceso de cliente de la demo (D23, D24). El correo real y Telegram ponen a trabajar al
 * modelo con documentos de afuera, así que solo se abren con un código que los clientes
 * reciben por fuera del repo. El acceso dura `ttlHours` y vale para los dos canales.
 *
 * Los intentos fallidos se limitan por empresa: pasados `MAX_ACCESS_ATTEMPTS` en
 * `ACCESS_ATTEMPT_WINDOW_MS`, el código no se revisa hasta que pase la ventana, ni siquiera
 * el correcto. Junto con el largo mínimo del código, adivinarlo no es viable.
 */

const HOUR_MS = 3_600_000;
export const MAX_ACCESS_ATTEMPTS = 5;
export const ACCESS_ATTEMPT_WINDOW_MS = 15 * 60_000;

/** El acceso vigente de la empresa a `now`, o null si nunca tuvo o ya venció. */
export async function activeAccess(
  db: Database,
  organizationId: Ulid,
  now: Date,
): Promise<AccessGrant | null> {
  const grant = await getAccessGrant(db, organizationId);
  return grant && grant.expiresAt > now.toISOString() ? grant : null;
}

/**
 * Da acceso a quien escribe el código correcto: el vigente si ya lo tiene, o uno nuevo por
 * `ttlHours`. Un código equivocado no escribe nada. Escribir el código otra vez no extiende
 * un acceso vigente: vence cuando se dijo.
 */
export async function grantDemoAccess(
  db: Database,
  input: {
    readonly organizationId: Ulid;
    readonly code: string;
    readonly expectedCode: string;
    readonly ttlHours: number;
    readonly now: Date;
    readonly newId: () => Ulid;
  },
): Promise<AccessGrant> {
  const windowStart = new Date(input.now.getTime() - ACCESS_ATTEMPT_WINDOW_MS).toISOString();
  const failures = await countAccessAttemptsSince(db, input.organizationId, windowStart);
  if (failures >= MAX_ACCESS_ATTEMPTS) {
    throw new UseCaseError("limit_reached", "Demasiados intentos con un código equivocado", {
      action: "Espera 15 minutos y vuelve a intentar",
      severity: "warning",
    });
  }
  if (!sameSecret(input.code.trim(), input.expectedCode)) {
    await insertAccessAttempt(db, {
      id: input.newId(),
      organizationId: input.organizationId,
      attemptedAt: input.now.toISOString(),
    });
    throw new UseCaseError("not_authorized", "El código de acceso no es válido", {
      action: "Escribe el código tal como lo recibiste",
      severity: "warning",
    });
  }
  const current = await activeAccess(db, input.organizationId, input.now);
  if (current) return current;
  const grant = {
    organizationId: input.organizationId,
    grantedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + input.ttlHours * HOUR_MS).toISOString(),
  };
  await saveAccessGrant(db, grant);
  return grant;
}

/** Lanza `not_authorized` si la empresa no tiene acceso vigente. */
export async function requireAccess(
  db: Database,
  organizationId: Ulid,
  now: Date,
): Promise<AccessGrant> {
  const grant = await activeAccess(db, organizationId, now);
  if (!grant) {
    throw new UseCaseError("not_authorized", "El acceso de cliente venció o no existe", {
      action: "Escribe otra vez el código de acceso",
      severity: "warning",
    });
  }
  return grant;
}
