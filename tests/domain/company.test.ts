import { describe, expect, it } from "vitest";

import { LedgerPeriodSchema, PeriodKeySchema, periodKey } from "@/src/domain/company";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("periodKey", () => {
  it("mes en UTC, incluso en el último segundo del año", () => {
    expect(periodKey(new Date("2026-10-17T05:00:00Z"), "month")).toBe("2026-10");
    expect(periodKey(new Date("2026-12-31T23:59:59Z"), "month")).toBe("2026-12");
    expect(periodKey(new Date("2027-01-01T00:00:00Z"), "month")).toBe("2027-01");
  });

  it.each([
    ["2021-01-03", "2020-W53"],
    ["2021-01-04", "2021-W01"],
    ["2024-12-30", "2025-W01"],
    ["2026-12-31", "2026-W53"],
    ["2027-01-01", "2026-W53"],
    ["2016-01-03", "2015-W53"],
    ["2026-10-17", "2026-W42"],
  ])("semana ISO de %s es %s", (date, expected) => {
    expect(periodKey(new Date(`${date}T12:00:00Z`), "week")).toBe(expected);
    expect(PeriodKeySchema.safeParse(expected).success).toBe(true);
  });

  it("rechaza fechas inválidas", () => {
    expect(() => periodKey(new Date("no es fecha"), "month")).toThrow(RangeError);
  });
});

describe("esquemas de empresa", () => {
  it.each(["2026-13", "2026-00", "2026-W54", "2026-W00", "2026-10-01", "26-10"])(
    "rechaza la clave de periodo %s",
    (key) => {
      expect(PeriodKeySchema.safeParse(key).success).toBe(false);
    },
  );

  it("el ledger no admite comprometer más que el límite", () => {
    const base = {
      organization_id: ULID,
      period_key: "2026-10",
      currency: "USD",
      limit: 100,
      committed: 100,
      updated_at: "2026-10-17T00:00:00.000Z",
    };
    expect(LedgerPeriodSchema.safeParse(base).success).toBe(true);
    expect(LedgerPeriodSchema.safeParse({ ...base, committed: 101 }).success).toBe(false);
  });
});
