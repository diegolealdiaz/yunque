import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Llaves de los canales de cliente: correo de entrada (D23) y Telegram (D24). Puro: no
 * depende de Next ni de la base.
 *
 * - El token de una dirección es la parte después del + y nadie lo adivina: 60 bits de azar
 *   en base32 minúscula, válidos en cualquier dirección de correo.
 * - El código de acceso y la contraseña del webhook se comparan en tiempo constante sobre
 *   su hash, así el largo de lo que manda el cliente tampoco filtra nada.
 */

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Token nuevo para una dirección: 12 caracteres base32, 60 bits de azar. Cumple
 * `InboundTokenSchema` del dominio. 256 es múltiplo de 32, así que el módulo no sesga.
 */
export function newInboundToken(): string {
  return Array.from(randomBytes(12), (b) => BASE32[b % 32]).join("");
}

/** Token de un enlace de conexión de Telegram: 16 caracteres base32, 80 bits de azar. */
export function newTelegramLinkToken(): string {
  return Array.from(randomBytes(16), (b) => BASE32[b % 32]).join("");
}

/** Igualdad de tiempo constante entre un valor recibido y el esperado. */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * El proveedor llama al webhook con autenticación básica en la URL
 * (`https://yunque:<secreto>@…`). Vale solo si la contraseña coincide; el usuario se ignora.
 */
export function verifyWebhookAuth(header: string | null, secret: string): boolean {
  // El esquema de autenticación no distingue mayúsculas (RFC 7235).
  if (header === null || !/^basic /i.test(header)) return false;
  const decoded = Buffer.from(header.slice("basic ".length), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  return sameSecret(decoded.slice(colon + 1), secret);
}

/** Dirección completa de un token: `local+token@dominio`. */
export function inboundAddressFor(base: string, token: string): string {
  const at = base.lastIndexOf("@");
  return `${base.slice(0, at)}+${token}${base.slice(at)}`;
}
