import { describe, expect, it } from "vitest";

import {
  calendarDate,
  clock,
  dueRelative,
  duration,
  instant,
  percent,
  shortHash,
  usdMicros,
} from "@/src/ui/format";

describe("formatos de pantalla", () => {
  it("vencimientos relativos al día de negocio", () => {
    expect(dueRelative("2026-10-17", "2026-10-17")).toBe("vence hoy");
    expect(dueRelative("2026-10-18", "2026-10-17")).toBe("vence mañana");
    expect(dueRelative("2026-10-19", "2026-10-17")).toBe("vence en 2 días");
    expect(dueRelative("2026-10-16", "2026-10-17")).toBe("vencida ayer");
    expect(dueRelative("2026-10-14", "2026-10-17")).toBe("vencida hace 3 días");
    expect(dueRelative(null, "2026-10-17")).toBe("sin vencimiento");
  });

  it("instantes en hora de Bogotá, fechas de calendario sin correrse de día", () => {
    expect(instant("2026-10-17T14:12:00.000Z")).toBe("17 oct, 09:12");
    // 03:30 UTC del 18 todavía es el 17 en Bogotá.
    expect(instant("2026-10-18T03:30:00.000Z")).toBe("17 oct, 22:30");
    expect(clock("2026-10-17T14:12:00.000Z")).toBe("09:12");
    expect(calendarDate("2026-10-18")).toBe("18 oct 2026");
  });

  it("porcentajes, costos y hashes", () => {
    expect(percent(0.9393)).toBe("93,9 %");
    expect(percent(1)).toBe("100 %");
    expect(usdMicros(2100)).toBe("0,0021 USD");
    expect(shortHash("3f9a1c2b9e")).toBe("3f9a1c…");
  });

  it("duraciones en la unidad más grande que se lee", () => {
    expect(duration(850)).toBe("850 ms");
    expect(duration(1240)).toBe("1,2 s");
    expect(duration(12 * 60_000 + 5000)).toBe("12 min");
    expect(duration(5 * 3_600_000 + 1)).toBe("5 h");
    expect(duration(3 * 86_400_000)).toBe("3 d");
    expect(duration(-5)).toBe("0 ms");
  });
});
