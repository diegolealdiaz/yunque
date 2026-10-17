import { describe, expect, it } from "vitest";

import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY, isTheme, otherTheme } from "@/src/ui/theme";

describe("tema de la interfaz", () => {
  it("reconoce solo los dos temas", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("sepia")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it("el selector alterna entre claro y oscuro", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme("dark")).toBe("light");
  });

  describe("script de arranque", () => {
    function run(stored: string | null, prefersDark: boolean, storageFails = false) {
      const dataset: Record<string, string> = {};
      const root = { dataset };
      const storage = {
        getItem: (key: string) => {
          if (storageFails) throw new Error("bloqueado");
          return key === THEME_STORAGE_KEY ? stored : null;
        },
      };
      const matchMedia = () => ({ matches: prefersDark });
      new Function("document", "localStorage", "matchMedia", THEME_BOOT_SCRIPT)(
        { documentElement: root },
        storage,
        matchMedia,
      );
      return root.dataset["theme"];
    }

    it("usa la elección guardada", () => {
      expect(run("dark", false)).toBe("dark");
      expect(run("light", true)).toBe("light");
    });

    it("sin elección, sigue al sistema", () => {
      expect(run(null, true)).toBe("dark");
      expect(run(null, false)).toBe("light");
      expect(run("otro", true)).toBe("dark");
    });

    it("con el almacenamiento bloqueado, queda claro", () => {
      expect(run(null, true, true)).toBe("light");
    });
  });
});
