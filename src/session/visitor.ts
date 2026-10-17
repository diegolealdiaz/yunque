import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Identidad del visitante de la demo (docs/practicas.md 58): una cookie firmada que apunta a
 * su propia empresa. La firma es HMAC-SHA256 con `SESSION_SECRET`; sin el secreto nadie
 * puede fabricar el identificador de otro visitante, y una cookie alterada simplemente no
 * vale. Ninguna ruta acepta un identificador de empresa desde el cliente.
 */

export const VISITOR_COOKIE = "yq_visitante";
/** Treinta días: suficiente para volver a la demo y reencontrar la propia empresa. */
export const VISITOR_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

const VISITOR_ID = /^[0-9a-f]{32}$/;

/** Identificador nuevo e impredecible: 128 bits de azar en hexadecimal. */
export function newVisitorId(): string {
  return randomBytes(16).toString("hex");
}

function signature(visitorId: string, secret: string): string {
  return createHmac("sha256", secret).update(`visitante:${visitorId}`).digest("base64url");
}

/** Valor de la cookie: `identificador.firma`. */
export function signVisitor(visitorId: string, secret: string): string {
  if (!VISITOR_ID.test(visitorId)) throw new RangeError("Identificador de visitante inválido");
  return `${visitorId}.${signature(visitorId, secret)}`;
}

/**
 * Identificador del visitante si la cookie es auténtica; null si falta, está mal formada o la
 * firma no coincide. La comparación es de tiempo constante.
 */
export function verifyVisitor(cookie: string | undefined, secret: string): string | null {
  if (cookie === undefined) return null;
  const dot = cookie.indexOf(".");
  if (dot < 0) return null;
  const visitorId = cookie.slice(0, dot);
  if (!VISITOR_ID.test(visitorId)) return null;
  const given = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(signature(visitorId, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? visitorId : null;
}
