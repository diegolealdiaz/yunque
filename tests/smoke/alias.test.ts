import { describe, expect, it } from "vitest";

describe("entorno de pruebas", () => {
  it("corre en Node 22 o superior", () => {
    const major = Number(process.versions.node.split(".")[0]);
    expect(major).toBeGreaterThanOrEqual(22);
  });
});
