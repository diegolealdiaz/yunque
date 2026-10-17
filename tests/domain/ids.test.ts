import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ReferenceSchema,
  UlidSchema,
  createUlidGenerator,
  makeReference,
  parseReference,
  ulidTime,
} from "@/src/domain/ids";

describe("ULID (P-13)", () => {
  it("produce 26 caracteres Crockford válidos", () => {
    const next = createUlidGenerator();
    const id = next();
    expect(UlidSchema.safeParse(id).success).toBe(true);
    expect(id).toHaveLength(26);
  });

  it("codifica el tiempo y es reversible", () => {
    const next = createUlidGenerator({ now: () => 1_760_000_000_000 });
    expect(ulidTime(next())).toBe(1_760_000_000_000);
  });

  it("vectores conocidos y límites del tiempo", () => {
    expect(createUlidGenerator({ now: () => 0 })().slice(0, 10)).toBe("0000000000");
    expect(createUlidGenerator({ now: () => 2 ** 48 - 1 })().slice(0, 10)).toBe("7ZZZZZZZZZ");
    expect(() => createUlidGenerator({ now: () => 2 ** 48 })()).toThrow(RangeError);
    expect(() => createUlidGenerator({ now: () => -1 })()).toThrow(RangeError);
    expect(() => createUlidGenerator({ now: () => 1, random: () => new Uint8Array(3) })()).toThrow(
      RangeError,
    );
  });

  it("el esquema rechaza caracteres fuera de Crockford y un primer carácter mayor que 7", () => {
    const valid = createUlidGenerator()();
    for (const bad of ["I", "L", "O", "U", "a"]) {
      expect(UlidSchema.safeParse(`${valid.slice(0, 25)}${bad}`).success).toBe(false);
    }
    expect(UlidSchema.safeParse(`8${valid.slice(1)}`).success).toBe(false);
    expect(UlidSchema.safeParse(valid.toLowerCase()).success).toBe(false);
  });

  it("propiedad: el tiempo codificado se recupera exacto", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 48 - 1 }), (t) => {
        expect(ulidTime(createUlidGenerator({ now: () => t })())).toBe(t);
      }),
    );
  });

  it("es monótono dentro del mismo milisegundo", () => {
    const next = createUlidGenerator({ now: () => 1_760_000_000_000 });
    const ids = Array.from({ length: 1000 }, () => next());
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
      expect(ids[i]!.slice(0, 10)).toBe(ids[0]!.slice(0, 10));
    }
  });

  it("no retrocede si el reloj retrocede", () => {
    let t = 1_760_000_000_000;
    const next = createUlidGenerator({ now: () => t });
    const first = next();
    t -= 5000;
    const second = next();
    expect(second > first).toBe(true);
    expect(ulidTime(second)).toBe(1_760_000_000_000);
  });

  it("propiedad: para cualquier secuencia de tiempos no decrecientes, los ids son estrictamente crecientes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 200 }),
        (deltas) => {
          let t = 1_700_000_000_000;
          let i = 0;
          const next = createUlidGenerator({
            now: () => {
              t += deltas[i++] ?? 0;
              return t;
            },
          });
          let previous = next();
          for (let k = 1; k < deltas.length; k++) {
            const current = next();
            expect(current > previous).toBe(true);
            previous = current;
          }
        },
      ),
    );
  });

  it("el espacio aleatorio se agota con error, no con un id repetido", () => {
    const next = createUlidGenerator({
      now: () => 1,
      random: () => new Uint8Array(10).fill(0xff),
    });
    next();
    expect(() => next()).toThrow(RangeError);
  });
});

describe("referencia legible (P-13)", () => {
  it("construye y valida el formato", () => {
    const ref = makeReference("YQ", 2026, 10, 7);
    expect(ref).toBe("YQ-2026-10-0007");
    expect(ReferenceSchema.safeParse(ref).success).toBe(true);
    expect(parseReference(ref)).toEqual({ prefix: "YQ", year: 2026, month: 10, sequence: 7 });
  });

  it("rechaza entradas fuera de rango", () => {
    expect(() => makeReference("yq", 2026, 10, 1)).toThrow(RangeError);
    expect(() => makeReference("YQ", 2026, 13, 1)).toThrow(RangeError);
    expect(() => makeReference("YQ", 2026, 0, 1)).toThrow(RangeError);
    expect(() => makeReference("YQ", 2026, 10, 0)).toThrow(RangeError);
    expect(() => makeReference("YQ", 1999, 10, 1)).toThrow(RangeError);
    expect(ReferenceSchema.safeParse("YQ-2026-10-0000").success).toBe(false);
    expect(() => parseReference("YQ-2026-10-0000")).toThrow(RangeError);
  });

  it("propiedad: única por empresa, año y mes, y reversible", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z]{2,4}$/),
        fc.integer({ min: 2000, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 99_999 }),
        (prefix, year, month, seq) => {
          const ref = makeReference(prefix, year, month, seq);
          expect(parseReference(ref)).toEqual({ prefix, year, month, sequence: seq });
          expect(makeReference(prefix, year, month, seq + 1)).not.toBe(ref);
        },
      ),
    );
  });
});
