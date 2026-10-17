import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson, type ApprovalPayload } from "@/src/domain";

/**
 * Firmas de la aprobación humana (invariante 8 y docs/practicas.md 43 y 44).
 *
 * - El contenido exacto que la persona ve al aprobar (documento, monto, beneficiario, cuenta,
 *   versión de política) se firma en el servidor con HMAC-SHA256 y `APPROVAL_SIGNING_SECRET`.
 *   Al aprobar, el servidor comprueba la firma y además recalcula el contenido desde la base:
 *   un contenido alterado no tiene firma válida, y uno viejo ya no coincide con la base.
 * - Quién aprueba, en la demo, es una persona elegida de la lista de aprobadores de la
 *   política, guardada en una cookie firmada con el otro secreto (`SESSION_SECRET`). No es
 *   autenticación: es la identidad de la demo, y el servidor la vuelve a verificar contra la
 *   política en cada acción.
 */

export const APPROVER_COOKIE = "yq_aprobador";

function hmac(secret: string, purpose: string, data: string): string {
  return createHmac("sha256", secret).update(`${purpose}:${data}`).digest("hex");
}

function equalHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Firma del contenido de una aprobación: HMAC sobre su JSON canónico. */
export function signApproval(payload: ApprovalPayload, secret: string): string {
  return hmac(secret, "aprobacion", canonicalJson(payload));
}

/** Verdadero si la firma corresponde exactamente a ese contenido. */
export function verifyApproval(
  payload: ApprovalPayload,
  signature: string,
  secret: string,
): boolean {
  return /^[0-9a-f]{64}$/.test(signature) && equalHex(signApproval(payload, secret), signature);
}

/** Valor de la cookie del aprobador: el nombre en base64url y su firma. */
export function signApprover(name: string, secret: string): string {
  const encoded = Buffer.from(name, "utf8").toString("base64url");
  return `${encoded}.${hmac(secret, "aprobador", encoded)}`;
}

/** Nombre del aprobador si la cookie es auténtica; null si falta o fue alterada. */
export function verifyApprover(cookie: string | undefined, secret: string): string | null {
  if (cookie === undefined) return null;
  const [encoded, signature, ...rest] = cookie.split(".");
  if (!encoded || !signature || rest.length > 0) return null;
  if (!equalHex(hmac(secret, "aprobador", encoded), signature)) return null;
  const name = Buffer.from(encoded, "base64url").toString("utf8");
  return name.length > 0 && name.length <= 200 ? name : null;
}
