"use client";

import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY, isTheme, otherTheme, type Theme } from "@/src/ui/theme";

import { MoonIcon, SunIcon } from "./icons";

/**
 * Selector de tema claro u oscuro. El tema vive en `<html data-theme>`, puesto antes de
 * pintar por el script de app/layout.tsx; este botón lo cambia y guarda la elección en el
 * navegador. Si el almacenamiento está bloqueado, el cambio dura hasta recargar.
 */

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function currentTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return isTheme(value) ? value : "light";
}

export function ThemeToggle({ compact = false }: { readonly compact?: boolean }) {
  // En el servidor no se sabe el tema: el botón se pinta sin texto hasta hidratar.
  const theme = useSyncExternalStore(subscribe, currentTheme, () => null);

  const toggle = () => {
    const next = otherTheme(theme ?? currentTheme());
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento la elección no se recuerda; el cambio igual se aplica.
    }
  };

  const label = theme === "dark" ? "Tema oscuro" : theme === "light" ? "Tema claro" : "Tema";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme ? `${label}. Cambiar a tema ${theme === "dark" ? "claro" : "oscuro"}` : label
      }
      className={`flex h-9 items-center rounded-[var(--radius-control)] border border-line-strong text-[13px] text-ink-2 hover:bg-surface-hover hover:text-ink ${
        compact ? "w-9 justify-center" : "w-full justify-between px-3"
      }`}
    >
      {compact ? null : <span>{label}</span>}
      {theme === "dark" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
