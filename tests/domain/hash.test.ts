import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  HashError,
  canonicalJson,
  documentHash,
  jsonHash,
  normalizeInvoiceNumber,
  normalizeText,
  semanticKey,
} from "@/src/domain/hash";

describe("hash de documento (P-14)", () => {
  it("es SHA-256 sobre los bytes, no sobre el texto", () => {
    const a = new TextEncoder().encode("factura");
    const b = new TextEncoder().encode("factura ");
    expect(documentHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(documentHash(a)).not.toBe(documentHash(b));
    expect(documentHash(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(
      documentHash(new TextEncoder().encode("%PDF")),
    );
  });

  it("propiedad: bytes distintos dan hashes distintos; los mismos, el mismo", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), fc.uint8Array({ maxLength: 200 }), (a, b) => {
        const same = a.length === b.length && a.every((v, i) => v === b[i]);
        expect(documentHash(a) === documentHash(b)).toBe(same);
      }),
    );
  });
});

describe("hash de JSON canónico", () => {
  it("no depende del orden de las claves ni de valores undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(jsonHash({ b: 1, a: 2 })).toBe(jsonHash({ a: 2, b: 1 }));
    expect(jsonHash({ a: 1, b: undefined })).toBe(jsonHash({ a: 1 }));
    expect(jsonHash([1, { z: 1, y: 2 }])).toBe(jsonHash([1, { y: 2, z: 1 }]));
    expect(jsonHash({ a: 1 })).not.toBe(jsonHash({ a: 2 }));
    expect(canonicalJson([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("rechaza valores que no son JSON puro en vez de firmar un objeto vacío", () => {
    expect(() => canonicalJson({ d: new Date(0) })).toThrow(HashError);
    expect(() => canonicalJson({ m: new Map() })).toThrow(HashError);
    expect(() => canonicalJson({ n: 10n })).toThrow(HashError);
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(HashError);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(HashError);
    expect(canonicalJson(Object.create(null))).toBe("{}");
  });
});

describe("llave semántica (P-14)", () => {
  it("normaliza mayúsculas, espacios, acentos y guiones", () => {
    expect(normalizeText("Nube Andina S.A.S.")).toBe("NUBE ANDINA SAS");
    expect(normalizeText("  Peña   & Gómez, Ltda ")).toBe("PENA GOMEZ LTDA");
    expect(normalizeInvoiceNumber("F-2291")).toBe("F2291");
    expect(normalizeInvoiceNumber("f 2291")).toBe("F2291");
    expect(normalizeInvoiceNumber("FAC/0002291")).toBe("FAC0002291");
  });

  it("la misma factura con otro formato produce la misma llave", () => {
    const a = semanticKey({
      payeeName: "Nube Andina S.A.S.",
      invoiceNumber: "F-2291",
      amount: 480_000_000,
      currency: "COP",
    });
    const b = semanticKey({
      payeeName: "nube andina sas",
      invoiceNumber: "f 2291",
      amount: 480_000_000,
      currency: "COP",
    });
    expect(a).toBe(b);
    expect(a).toBe("NUBE ANDINA SAS|F2291|480000000|COP");
  });

  it("conserva alfabetos no latinos y rechaza partes vacías", () => {
    expect(normalizeText("株式会社 東京")).toBe("株式会社 東京");
    expect(normalizeText("ООО Ромашка")).toBe("ООО РОМАШКА");
    expect(normalizeText("Łódź Øre Straße")).toBe("ŁODZ ØRE STRASSE");
    const cjkA = semanticKey({
      payeeName: "株式会社",
      invoiceNumber: "1",
      amount: 1,
      currency: "USD",
    });
    const cjkB = semanticKey({ payeeName: "東京", invoiceNumber: "1", amount: 1, currency: "USD" });
    expect(cjkA).not.toBe(cjkB);
    expect(() =>
      semanticKey({ payeeName: "---", invoiceNumber: "1", amount: 1, currency: "USD" }),
    ).toThrow(HashError);
    expect(() =>
      semanticKey({ payeeName: "X", invoiceNumber: " . ", amount: 1, currency: "USD" }),
    ).toThrow(HashError);
    expect(() =>
      semanticKey({ payeeName: "X", invoiceNumber: "1", amount: 1.5, currency: "USD" }),
    ).toThrow(HashError);
  });

  it("monto o moneda distintos producen llaves distintas", () => {
    const base = { payeeName: "X", invoiceNumber: "1", amount: 100, currency: "USD" as const };
    expect(semanticKey(base)).not.toBe(semanticKey({ ...base, amount: 101 }));
    expect(semanticKey(base)).not.toBe(semanticKey({ ...base, currency: "COP" }));
    expect(semanticKey(base)).not.toBe(semanticKey({ ...base, invoiceNumber: "2" }));
  });

  it("propiedad: la normalización es idempotente y estable ante espacios, guiones y mayúsculas", () => {
    const arbName = fc.stringMatching(/^[A-Za-zÁÉÍÓÚáéíóúÑñЖжλ株0-9 .,&-]{1,40}$/);
    fc.assert(
      fc.property(arbName, fc.integer({ min: 0, max: 5 }), (name, pad) => {
        const normalized = normalizeText(name);
        expect(normalizeText(normalized)).toBe(normalized);
        const noisy = `${" ".repeat(pad)}${name.toLowerCase().split(" ").join("  ")}${"-".repeat(pad)}`;
        expect(normalizeText(noisy)).toBe(normalized);
      }),
    );
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,20}$/),
        fc.constantFrom("-", " ", "/", "."),
        (n, sep) => {
          const spaced = n.split("").join(sep);
          expect(normalizeInvoiceNumber(spaced)).toBe(n.toUpperCase());
        },
      ),
    );
  });
});
