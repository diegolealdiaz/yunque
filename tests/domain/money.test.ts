import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CURRENCIES, type Currency } from "@/src/domain/currency";
import { FxTableSchema, convert, fromUsd, toUsd, type FxTable } from "@/src/domain/fx";
import {
  MoneyError,
  add,
  compare,
  deviationBasisPoints,
  equals,
  formatMoney,
  isGreaterOrEqual,
  isGreaterThan,
  isLessThan,
  money,
  multiplyRatio,
  parseMoney,
  percentOf,
  roundDiv,
  subtract,
  sum,
} from "@/src/domain/money";

const SAFE = 1_000_000_000_000; // 10 mil millones de USD en centavos: margen de sobra
const arbCurrency = fc.constantFrom<Currency>(...CURRENCIES);
const arbAmount = fc.integer({ min: -SAFE, max: SAFE });
const arbMoney = fc.record({ amount: arbAmount, currency: arbCurrency });

const fx: FxTable = {
  base: "USD",
  asOf: "2026-10-01",
  perUsd: {
    USD: 1_000_000,
    EUR: 920_000,
    COP: 4_150_250_000,
    BRL: 5_320_000,
    MXN: 18_250_000,
    ARS: 1_450_000_000,
  },
};

describe("dinero (P-10)", () => {
  it("suma y resta en la misma moneda", () => {
    expect(add(money(100, "USD"), money(250, "USD"))).toEqual({ amount: 350, currency: "USD" });
    expect(subtract(money(100, "USD"), money(250, "USD"))).toEqual({
      amount: -150,
      currency: "USD",
    });
  });

  it("rechaza mezclar monedas en suma, resta y comparación", () => {
    expect(() => add(money(1, "USD"), money(1, "COP"))).toThrow(MoneyError);
    expect(() => subtract(money(1, "USD"), money(1, "COP"))).toThrow(MoneyError);
    expect(() => compare(money(1, "USD"), money(1, "COP"))).toThrow(MoneyError);
    expect(() => sum([money(1, "USD"), money(1, "EUR")], "USD")).toThrow(MoneyError);
  });

  it("rechaza montos que no sean enteros seguros", () => {
    expect(() => money(1.5, "USD")).toThrow(MoneyError);
    expect(() => money(Number.NaN, "USD")).toThrow(MoneyError);
    expect(() => money(2 ** 53, "USD")).toThrow(MoneyError);
  });

  it("lanza al desbordar el rango seguro en vez de perder precisión", () => {
    const max = money(Number.MAX_SAFE_INTEGER, "USD");
    expect(() => add(max, money(1, "USD"))).toThrow(MoneyError);
    expect(() => subtract(money(-Number.MAX_SAFE_INTEGER, "USD"), money(1, "USD"))).toThrow(
      MoneyError,
    );
    expect(() => multiplyRatio(max, 2, 1)).toThrow(MoneyError);
  });

  it("igualdad y comparaciones en la frontera exacta", () => {
    const a = money(100, "USD");
    expect(equals(a, money(100, "USD"))).toBe(true);
    expect(equals(a, money(100, "COP"))).toBe(false);
    expect(isGreaterThan(a, money(100, "USD"))).toBe(false);
    expect(isGreaterOrEqual(a, money(100, "USD"))).toBe(true);
    expect(isLessThan(a, money(100, "USD"))).toBe(false);
    expect(isGreaterThan(money(101, "USD"), a)).toBe(true);
    expect(isLessThan(money(99, "USD"), a)).toBe(true);
  });

  it("propiedad: la suma es asociativa y conmutativa y nunca produce decimales", () => {
    fc.assert(
      fc.property(arbCurrency, arbAmount, arbAmount, arbAmount, (c, a, b, d) => {
        const left = add(add(money(a, c), money(b, c)), money(d, c));
        const right = add(money(a, c), add(money(b, c), money(d, c)));
        expect(left).toEqual(right);
        expect(add(money(a, c), money(b, c))).toEqual(add(money(b, c), money(a, c)));
        expect(Number.isInteger(left.amount)).toBe(true);
      }),
    );
  });

  it("redondeo medio hacia arriba sobre el valor absoluto, documentado y estable", () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(7n, 2n)).toBe(4n);
    expect(roundDiv(4n, 2n)).toBe(2n);
    expect(roundDiv(1n, 3n)).toBe(0n);
    expect(roundDiv(2n, 3n)).toBe(1n);
    expect(() => roundDiv(1n, 0n)).toThrow(MoneyError);
  });

  it("porcentajes en puntos básicos con un solo redondeo", () => {
    expect(percentOf(money(10_000, "USD"), 500)).toEqual({ amount: 500, currency: "USD" });
    expect(percentOf(money(333, "USD"), 1000)).toEqual({ amount: 33, currency: "USD" });
    expect(percentOf(money(335, "USD"), 1000)).toEqual({ amount: 34, currency: "USD" });
    expect(multiplyRatio(money(100, "COP"), 1, 3)).toEqual({ amount: 33, currency: "COP" });
  });

  it("desviación relativa en puntos básicos", () => {
    expect(deviationBasisPoints(money(1050, "USD"), money(1000, "USD"))).toBe(500);
    expect(deviationBasisPoints(money(950, "USD"), money(1000, "USD"))).toBe(500);
    expect(deviationBasisPoints(money(0, "USD"), money(0, "USD"))).toBe(0);
    expect(deviationBasisPoints(money(5, "USD"), money(0, "USD"))).toBe(Number.POSITIVE_INFINITY);
    expect(deviationBasisPoints(money(1, "USD"), money(3, "USD"))).toBe(6667);
    expect(deviationBasisPoints(money(-50, "USD"), money(100, "USD"))).toBe(15_000);
  });

  it("propiedad: multiplicar por una fracción y por su inversa deja un error de a lo sumo una unidad", () => {
    fc.assert(
      fc.property(
        arbCurrency,
        fc.integer({ min: 0, max: SAFE }),
        fc.integer({ min: 1, max: 1000 }),
        (c, a, n) => {
          const scaled = multiplyRatio(money(a, c), n, 1);
          const back = multiplyRatio(scaled, 1, n);
          expect(Math.abs(back.amount - a)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe("conversión FX (P-10)", () => {
  it("convierte a USD con un solo redondeo", () => {
    // 4.150.250 COP = 1.000,00 USD con la tasa fija del set
    expect(toUsd(money(415_025_000, "COP"), fx)).toEqual({ amount: 100_000, currency: "USD" });
    expect(toUsd(money(920, "EUR"), fx)).toEqual({ amount: 1000, currency: "USD" });
    expect(toUsd(money(12_345, "USD"), fx)).toEqual({ amount: 12_345, currency: "USD" });
  });

  it("la tabla exige que USD valga exactamente un millón", () => {
    expect(FxTableSchema.safeParse(fx).success).toBe(true);
    expect(
      FxTableSchema.safeParse({ ...fx, perUsd: { ...fx.perUsd, USD: 2_000_000 } }).success,
    ).toBe(false);
    const { USD: _usd, ...partial } = fx.perUsd;
    expect(FxTableSchema.safeParse({ ...fx, perUsd: partial }).success).toBe(false);
  });

  it("lanza si la conversión desborda el rango seguro", () => {
    expect(() => fromUsd(money(Number.MAX_SAFE_INTEGER, "USD"), "COP", fx)).toThrow(MoneyError);
  });

  it("convierte desde USD", () => {
    expect(fromUsd(money(100_000, "USD"), "COP", fx)).toEqual({
      amount: 415_025_000,
      currency: "COP",
    });
    expect(() => fromUsd(money(1, "COP"), "USD", fx)).toThrow();
  });

  it("propiedad: convertir en dos tramos nunca difiere del total en más de un centavo por tramo", () => {
    fc.assert(
      fc.property(
        arbCurrency,
        fc.integer({ min: 0, max: SAFE }),
        fc.integer({ min: 0, max: SAFE }),
        (c, a, b) => {
          const whole = toUsd(money(a + b, c), fx).amount;
          const parts = toUsd(money(a, c), fx).amount + toUsd(money(b, c), fx).amount;
          expect(Math.abs(whole - parts)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("propiedad: ida y vuelta por USD se queda dentro del error de redondeo", () => {
    fc.assert(
      fc.property(arbCurrency, fc.integer({ min: 0, max: SAFE }), (c, a) => {
        const back = convert(convert(money(a, c), "USD", fx), c, fx);
        // Un centavo de USD en la moneda de origen, más uno por el redondeo final.
        const centUsdInSource = fromUsd(money(1, "USD"), c, fx).amount;
        expect(Math.abs(back.amount - a)).toBeLessThanOrEqual(centUsdInSource + 1);
      }),
    );
  });
});

describe("formato y parseo (P-11)", () => {
  it("formatea con el código ISO al final y sin símbolos", () => {
    expect(formatMoney(money(480_000_000, "COP"))).toBe("4.800.000 COP");
    expect(formatMoney(money(125_000, "USD"))).toBe("1,250.00 USD");
    expect(formatMoney(money(-3750, "EUR"))).toBe("-37,50 EUR");
    expect(formatMoney(money(5, "MXN"))).toBe("0.05 MXN");
    expect(formatMoney(money(0, "BRL"))).toBe("0,00 BRL");
    expect(formatMoney(money(123_456_789, "ARS"))).toBe("1.234.567,89 ARS");
    expect(formatMoney(money(100_000_000_000, "USD"))).toBe("1,000,000,000.00 USD");
    expect(formatMoney(money(480_000_050, "COP"))).toBe("4.800.001 COP");
    expect(formatMoney(money(480_000_049, "COP"))).toBe("4.800.000 COP");
  });

  it("nunca contiene símbolos de moneda", () => {
    for (const c of CURRENCIES) {
      const text = formatMoney(money(123_456, c));
      expect(text.endsWith(` ${c}`)).toBe(true);
      expect(text.slice(0, -4)).toMatch(/^-?[0-9.,]+$/);
    }
  });

  it("parsea el inverso exacto", () => {
    expect(parseMoney("4.800.000 COP")).toEqual({ amount: 480_000_000, currency: "COP" });
    expect(parseMoney("1,250.00 USD")).toEqual({ amount: 125_000, currency: "USD" });
    expect(parseMoney("1250 USD")).toEqual({ amount: 125_000, currency: "USD" });
    expect(parseMoney("-37,50 EUR")).toEqual({ amount: -3750, currency: "EUR" });
    expect(parseMoney("0.50 USD")).toEqual({ amount: 50, currency: "USD" });
    expect(() => parseMoney("0.5 USD")).toThrow(MoneyError);
  });

  it("rechaza separadores mal puestos aunque los dígitos sean válidos", () => {
    for (const text of [
      "1,,250.00 USD",
      ",1250 USD",
      "1.2.3.4 COP",
      "1250. USD",
      "00012 USD",
      "4.800.000,5 COP",
      "1,250.0 USD",
      "1,2500.00 USD",
    ]) {
      expect(() => parseMoney(text), text).toThrow(MoneyError);
    }
  });

  it("rechaza formatos ajenos", () => {
    expect(() => parseMoney("$1,250.00")).toThrow(MoneyError);
    expect(() => parseMoney("1,250.00")).toThrow(MoneyError);
    expect(() => parseMoney("1.250,00 USD")).toThrow(MoneyError);
    expect(() => parseMoney("1,250.001 USD")).toThrow(MoneyError);
    expect(() => parseMoney("12 XYZ")).toThrow(MoneyError);
    expect(() => parseMoney("R$ 10,00 BRL")).toThrow(MoneyError);
  });

  it("propiedad: parseMoney(formatMoney(m)) recupera el entero exacto", () => {
    fc.assert(
      fc.property(arbMoney, (m) => {
        // COP se muestra en pesos enteros: la ida y vuelta exacta se prueba sin centavos.
        // El redondeo de centavos de COP al formatear se prueba aparte, con casos fijos.
        const amount = m.currency === "COP" ? m.amount - (m.amount % 100) : m.amount;
        const value = money(amount, m.currency);
        expect(parseMoney(formatMoney(value))).toEqual(value);
      }),
    );
  });
});
