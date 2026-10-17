import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  newVisitorId,
  securityHeaders,
  signVisitor,
  verifyVisitor,
} from "@/src/session";

const SECRET = "secreto-de-prueba-de-al-menos-32-caracteres";

describe("cookie firmada del visitante (docs/practicas.md 58)", () => {
  it("una cookie firmada vuelve a su visitante; cualquier alteración la invalida", () => {
    const id = newVisitorId();
    const cookie = signVisitor(id, SECRET);
    expect(verifyVisitor(cookie, SECRET)).toBe(id);

    const other = newVisitorId();
    const [, sig] = cookie.split(".");
    expect(verifyVisitor(`${other}.${sig ?? ""}`, SECRET)).toBeNull();
    expect(verifyVisitor(`${id}.${(sig ?? "").slice(0, -1)}x`, SECRET)).toBeNull();
    expect(verifyVisitor(cookie, `${SECRET}-otro`)).toBeNull();
    expect(verifyVisitor(id, SECRET)).toBeNull();
    expect(verifyVisitor("", SECRET)).toBeNull();
    expect(verifyVisitor(undefined, SECRET)).toBeNull();
    expect(verifyVisitor(`../../${id}.${sig ?? ""}`, SECRET)).toBeNull();
  });

  it("los identificadores son impredecibles y bien formados", () => {
    const ids = new Set(Array.from({ length: 200 }, newVisitorId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(() => signVisitor("org-de-otro", SECRET)).toThrow(RangeError);
  });
});

describe("política de seguridad de contenido (docs/practicas.md 24)", () => {
  it("scripts solo propios con el nonce; sin eval en producción; no se puede incrustar", () => {
    const prod = contentSecurityPolicy("abc123", false);
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("style-src 'self' 'nonce-abc123'");
    expect(prod).not.toMatch(/style-src [^;]*unsafe-inline/);
    expect(contentSecurityPolicy("abc123", true)).toContain("'unsafe-eval'");
    expect(securityHeaders()["X-Frame-Options"]).toBe("DENY");
  });
});
