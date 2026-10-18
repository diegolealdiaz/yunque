"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

gsap.registerPlugin(useGSAP);

/**
 * Menú de la portada en el teléfono. Dos barras que se cruzan en una X moviendo sus puntas
 * (no girando el ícono), un panel que entra desde la derecha con un resorte corto y las
 * filas escalonadas. La salida es sobria: el panel vuelve a la derecha.
 *
 * Accesible: `aria-expanded` en el botón, Esc cierra y devuelve el foco, Tab no sale del menú
 * abierto, la página no se desplaza detrás, y al pasar a escritorio el menú se cierra. Con
 * "reducir movimiento" abre y cierra sin animar.
 */

type Line = { x1: number; y1: number; x2: number; y2: number };

const BARS: Readonly<Record<"top" | "bottom", { shut: Line; open: Line }>> = {
  top: { shut: { x1: 0.5, y1: 4.75, x2: 15.5, y2: 4.75 }, open: { x1: 1, y1: 1, x2: 15, y2: 15 } },
  bottom: {
    shut: { x1: 0.5, y1: 11.25, x2: 15.5, y2: 11.25 },
    open: { x1: 15, y1: 1, x2: 1, y2: 15 },
  },
};

export type MenuLink = { readonly href: string; readonly label: string };

export function MobileMenu({
  links,
  demoHref,
}: {
  readonly links: readonly MenuLink[];
  readonly demoHref: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const top = useRef<SVGLineElement>(null);
  const bottom = useRef<SVGLineElement>(null);
  const running = useRef<gsap.core.Timeline | null>(null);

  // El estado manda; la animación lo sigue. Cada cambio corta la anterior y parte de donde
  // quedó, así reabrir a mitad del cierre no salta.
  useGSAP(
    () => {
      running.current?.kill();
      const el = panel.current;
      if (!el) return;
      const rows = el.querySelectorAll("[data-menu-row]");
      const bars = [
        [top.current, BARS.top],
        [bottom.current, BARS.bottom],
      ] as const;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = still ? 0 : 1;
      const tl = gsap.timeline({ defaults: { duration: 0 } });
      if (open) {
        // Visible ya, no en el primer cuadro: el foco entra al menú en el mismo paso.
        gsap.set(el, { autoAlpha: 1 });
        el.querySelector<HTMLElement>("a[href]")?.focus({ preventScroll: true });
        tl.fromTo(
          el,
          { xPercent: 101 },
          { xPercent: 0, duration: 0.6 * duration, ease: "back.out(1.1)" },
          0,
        ).fromTo(
          rows,
          // Opacidad y no visibilidad: un enlace oculto no puede recibir el foco.
          { opacity: 0, x: -20 },
          { opacity: 1, x: 0, duration: 1.1 * duration, stagger: 0.04, ease: "expo.out" },
          0.1 * duration,
        );
        for (const [line, pose] of bars) {
          tl.to(
            line,
            { attr: pose.open, duration: 0.35 * duration, ease: "back.out(1.4)" },
            0.06 * duration,
          );
        }
      } else {
        tl.to(el, { xPercent: 101, duration: 0.4 * duration, ease: "power3.in" }, 0).set(el, {
          autoAlpha: 0,
        });
        for (const [line, pose] of bars) {
          tl.to(line, { attr: pose.shut, duration: 0.2 * duration, ease: "power3.in" }, 0);
        }
      }
      running.current = tl;
    },
    { dependencies: [open], revertOnUpdate: false },
  );

  const close = useCallback(() => setOpen(false), []);

  // Abierto: la página no se desplaza detrás y, al pasar a escritorio, se cierra.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 768px)");
    const onDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", onDesktop);
    return () => {
      document.body.style.overflow = previous;
      desktop.removeEventListener("change", onDesktop);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      toggle.current?.focus();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    // Tab recorre el menú y el botón que lo cierra, y no sale de ahí.
    const focusable = [
      toggle.current,
      ...panel.current.querySelectorAll<HTMLElement>("a[href]"),
    ].filter((el): el is HTMLElement => el !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="md:hidden" onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls="menu-portada"
        aria-label={open ? "Cerrar menú" : "Abrir menú"}
        onClick={() => setOpen(!open)}
        className="relative z-50 inline-flex size-9 items-center justify-center rounded-full border border-line-strong text-ink hover:bg-surface-hover"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <line
            ref={top}
            {...BARS.top.shut}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <line
            ref={bottom}
            {...BARS.bottom.shut}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div
        ref={panel}
        id="menu-portada"
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        aria-hidden={!open}
        // Oculto y fuera del orden de tabulación hasta abrir: `autoAlpha` lo maneja.
        className="invisible fixed inset-0 z-40 flex flex-col bg-paper px-6 pt-24 pb-8"
      >
        <nav aria-label="Secciones de la portada" className="flex-1">
          <ul>
            {links.map((link) => (
              <li key={link.href} data-menu-row className="border-b border-line">
                <a
                  href={link.href}
                  onClick={close}
                  className="flex items-center justify-between py-5 text-[22px] font-semibold tracking-tight text-ink"
                >
                  {link.label}
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div data-menu-row>
          <Link href={demoHref} className="btn-primary h-12 w-full text-[15px]">
            Probar la demo
          </Link>
          <p className="mt-3 text-center text-[13px] text-ink-3">
            Sin registro · datos de ejemplo · ningún pago real
          </p>
        </div>
      </div>
    </div>
  );
}
