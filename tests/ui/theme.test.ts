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
    let lastMotion: {
      before: string | undefined;
      timers: (() => void)[];
      dataset: Record<string, string>;
    } = { before: undefined, timers: [], dataset: {} };
    function run(
      stored: string | null,
      prefersDark: boolean,
      storageFails = false,
      reduceMotion = false,
    ) {
      const dataset: Record<string, string> = {};
      const root = { dataset };
      const storage = {
        getItem: (key: string) => {
          if (storageFails) throw new Error("bloqueado");
          return key === THEME_STORAGE_KEY ? stored : null;
        },
      };
      const matchMedia = (query: string) => ({
        matches: query.includes("reduced-motion") ? reduceMotion : prefersDark,
      });
      const timers: (() => void)[] = [];
      const setTimeout = (fn: () => void) => timers.push(fn);
      new Function("document", "localStorage", "matchMedia", "setTimeout", THEME_BOOT_SCRIPT)(
        { documentElement: root },
        storage,
        matchMedia,
        setTimeout,
      );
      lastMotion = { before: dataset["motion"], timers, dataset };
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

    it("arma el velo de la entrada salvo con «reducir movimiento», y se levanta solo", () => {
      run(null, false);
      expect(lastMotion.before).toBe("on");
      lastMotion.timers.forEach((fire) => fire());
      expect(lastMotion.dataset["motion"]).toBe("done");
      run(null, false, false, true);
      expect(lastMotion.before).toBeUndefined();
      expect(lastMotion.timers).toHaveLength(0);
    });

    it("con el almacenamiento bloqueado, queda claro", () => {
      expect(run(null, true, true)).toBe("light");
    });
  });
});
