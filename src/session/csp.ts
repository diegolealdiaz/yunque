/**
 * Política de seguridad de contenido (docs/practicas.md 24). Estricta en scripts: solo los
 * del propio sitio con el nonce de la petición. El contenido de una factura nunca llega como
 * HTML, pero si algo se colara, el navegador no lo ejecutaría.
 *
 * - `style-src-attr 'unsafe-inline'` permite atributos `style` (posiciones de las citas sobre
 *   la página, anchos de columna); un atributo de estilo no ejecuta código.
 * - `frame-ancestors 'none'`: la app no se puede incrustar en otro sitio (clickjacking).
 * - En desarrollo React necesita `'unsafe-eval'` para sus trazas, y el panel de desarrollo de
 *   Next inyecta estilos sin nonce; por eso ahí se permiten estilos en línea (con un nonce
 *   presente el navegador ignoraría `'unsafe-inline'`). En producción, nada de eso.
 */
export function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Cabeceras de seguridad que acompañan a cada página. */
export function securityHeaders(): Readonly<Record<string, string>> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}
