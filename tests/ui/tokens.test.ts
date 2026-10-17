import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * P-100, contraste: lee los tokens de app/globals.css y comprueba cada par de uso con la
 * fórmula de WCAG 2.2. Texto 4.5:1 sobre su fondo; chips, puntos y bordes de foco 3:1.
 */

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("@theme"));

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root);
  if (!match?.[1]) throw new Error(`falta el token --${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const TEXT_PAIRS: readonly [string, string][] = [
  ["ink", "paper"],
  ["ink", "surface"],
  ["ink", "surface-hover"],
  ["ink-2", "paper"],
  ["ink-2", "surface"],
  ["ink-2", "surface-hover"],
  ["ink-3", "paper"],
  ["ink-3", "surface"],
  ["pay", "pay-tint"],
  ["escalate", "escalate-tint"],
  ["hold", "hold-tint"],
  ["pending", "pending-tint"],
  ["surface", "ink"],
];

const GRAPHIC_PAIRS: readonly [string, string][] = [
  ["pay-solid", "surface"],
  ["escalate-solid", "surface"],
  ["hold-solid", "surface"],
  ["pay-solid", "paper"],
  ["escalate-solid", "paper"],
  ["hold-solid", "paper"],
  ["focus", "paper"],
  ["focus", "surface"],
  ["control", "surface"],
  ["control", "paper"],
];

describe("contraste de los tokens (P-100)", () => {
  it.each(TEXT_PAIRS)("texto --%s sobre --%s cumple 4.5:1", (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(GRAPHIC_PAIRS)("marca --%s sobre --%s cumple 3:1", (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });

  it("la fórmula da los valores de referencia", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});
