"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { NAV_ITEMS } from "./sidebar";

/**
 * Atajos globales (docs/interfaz.md §4):
 * - `G` seguido de `P`, `F`, `R`, `M` o `B` cambia de sección;
 * - `/` lleva al buscador de la pantalla (el elemento con `data-shortcut="buscar"`);
 * - `Esc` vuelve a la lista desde un detalle (el enlace con `data-shortcut="volver"`).
 * Ninguno actúa mientras se escribe en un campo. Aprobar no tiene atajo a propósito.
 */

const SECTION_BY_KEY = new Map<string, string>(
  NAV_ITEMS.filter((item) => !item.demoOnly).map((item) => [item.shortcut, item.href]),
);
/** Ventana para la segunda tecla de `G` + letra. */
const CHORD_MS = 1200;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    let chordStartedAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const key = event.key.toLowerCase();

      if (Date.now() - chordStartedAt < CHORD_MS) {
        chordStartedAt = 0;
        const href = SECTION_BY_KEY.get(key);
        if (href) {
          event.preventDefault();
          router.push(href);
        }
        return;
      }
      if (key === "g") {
        chordStartedAt = Date.now();
        return;
      }
      if (key === "/") {
        const search = document.querySelector<HTMLElement>('[data-shortcut="buscar"]');
        if (search) {
          event.preventDefault();
          search.focus();
        }
        return;
      }
      if (key === "escape") {
        const back = document.querySelector<HTMLAnchorElement>('a[data-shortcut="volver"]');
        if (back) {
          event.preventDefault();
          router.push(back.pathname + back.search);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return null;
}
