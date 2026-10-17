import { describe, expect, it } from "vitest";

import { businessDateOf, engineNow, startOfBusinessDay } from "@/src/usecases";

describe("día de negocio (P-83)", () => {
  it("la fecha de calendario sale de la zona de la empresa, no de UTC", () => {
    // 22:30 en Bogotá del 17 son las 03:30 UTC del 18.
    expect(businessDateOf(new Date("2026-10-18T03:30:00.000Z"), "America/Bogota")).toBe(
      "2026-10-17",
    );
    expect(businessDateOf(new Date("2026-10-18T05:00:00.000Z"), "America/Bogota")).toBe(
      "2026-10-18",
    );
    expect(businessDateOf(new Date("2026-10-18T03:30:00.000Z"), "UTC")).toBe("2026-10-18");
  });

  it("el motor recibe la medianoche UTC del día de negocio", () => {
    expect(engineNow("2026-10-17").toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(() => engineNow("2026-02-30")).toThrow(RangeError);
    expect(() => engineNow("17/10/2026")).toThrow(RangeError);
  });
});

describe("inicio del día de negocio", () => {
  it("es la medianoche local de la empresa, expresada en UTC", () => {
    // Bogotá es UTC-5 todo el año: el día empieza a las 05:00 UTC.
    expect(
      startOfBusinessDay(new Date("2026-10-17T20:00:00.000Z"), "America/Bogota").toISOString(),
    ).toBe("2026-10-17T05:00:00.000Z");
    // A las 02:00 UTC del 18 todavía es el 17 en Bogotá.
    expect(
      startOfBusinessDay(new Date("2026-10-18T02:00:00.000Z"), "America/Bogota").toISOString(),
    ).toBe("2026-10-17T05:00:00.000Z");
    expect(startOfBusinessDay(new Date("2026-10-17T20:00:00.000Z"), "UTC").toISOString()).toBe(
      "2026-10-17T00:00:00.000Z",
    );
  });
});
