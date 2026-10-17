import { describe, expect, it } from "vitest";

import { businessDateOf, engineNow } from "@/src/usecases";

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
