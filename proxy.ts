import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getConfig } from "@/src/config";
import {
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE_S,
  contentSecurityPolicy,
  newVisitorId,
  securityHeaders,
  signVisitor,
  verifyVisitor,
} from "@/src/session";

/**
 * Antes de cada página:
 * 1. Un nonce nuevo y la política de seguridad de contenido que lo exige. Next lee el nonce
 *    de la cabecera de la petición y lo pone en sus propios scripts.
 * 2. Las cabeceras de seguridad (sin incrustar en otros sitios, sin adivinar tipos).
 * 3. En la demo, la cookie firmada del visitante si no trae una válida. Se agrega también a la
 *    petición en curso, así la primera página ya encuentra su empresa.
 *
 * Esto es solo el borde: quién es el visitante lo decide el servidor al verificar la firma,
 * no este archivo.
 */
export function proxy(request: NextRequest) {
  const config = getConfig();
  const nonce = randomBytes(16).toString("base64");
  const csp = contentSecurityPolicy(nonce, config.env === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  let issued: string | null = null;
  const secret = config.secrets.session;
  if (
    config.demo.enabled &&
    verifyVisitor(request.cookies.get(VISITOR_COOKIE)?.value, secret) === null
  ) {
    issued = signVisitor(newVisitorId(), secret);
    request.cookies.set(VISITOR_COOKIE, issued);
    requestHeaders.set("cookie", request.cookies.toString());
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  for (const [name, value] of Object.entries(securityHeaders())) response.headers.set(name, value);
  if (issued) {
    response.cookies.set(VISITOR_COOKIE, issued, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.env === "production",
      path: "/",
      maxAge: VISITOR_COOKIE_MAX_AGE_S,
    });
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Todo salvo archivos estáticos y prefetch de enlaces, que no renderizan páginas.
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
