"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Controls } from "@/src/domain";

import {
  ChartIcon,
  CloseIcon,
  InboxIcon,
  ListIcon,
  LogIcon,
  MenuIcon,
  PlayIcon,
  PlugIcon,
  RulesIcon,
} from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { TOUR_OPEN_EVENT } from "@/src/ui/tour";

/**
 * Barra lateral (docs/interfaz.md §4): cinco destinos en orden de uso y, abajo, el estado
 * de los controles y la salud. Están siempre a la vista porque son el argumento de
 * seguridad del producto: cualquiera ve si los pagos están encendidos y en qué modo decide.
 * Por debajo de 1024 px la barra se pliega: una barra superior con el nombre, el contador y
 * un botón de menú que la abre encima del contenido; se cierra sola al navegar.
 */

export type HealthLevel = "ok" | "degradada" | "caida";

export type ShellState = {
  readonly organizationName: string;
  /** Facturas que esperan decisión de una persona. */
  readonly pendingCount: number;
  readonly controls: Controls;
  readonly health: HealthLevel;
  /** Es la demo: aparece "Probar el agente". */
  readonly demo: boolean;
};

export const NAV_ITEMS = [
  { href: "/probar", label: "Probar el agente", Icon: PlayIcon, shortcut: "t", demoOnly: true },
  { href: "/pendientes", label: "Pendientes", Icon: InboxIcon, shortcut: "p", demoOnly: false },
  { href: "/facturas", label: "Facturas", Icon: ListIcon, shortcut: "f", demoOnly: false },
  { href: "/reglas", label: "Reglas", Icon: RulesIcon, shortcut: "r", demoOnly: false },
  { href: "/metricas", label: "Métricas", Icon: ChartIcon, shortcut: "m", demoOnly: false },
  { href: "/bitacora", label: "Bitácora", Icon: LogIcon, shortcut: "b", demoOnly: false },
  { href: "/conectar", label: "Conectar", Icon: PlugIcon, shortcut: "c", demoOnly: true },
] as const;

const HEALTH: Readonly<Record<HealthLevel, { label: string; dot: string }>> = {
  ok: { label: "En orden", dot: "bg-pay-solid" },
  degradada: { label: "Degradada", dot: "bg-escalate-solid" },
  caida: { label: "Con fallas", dot: "bg-hold-solid" },
};

function Brand() {
  return (
    <Link
      href="/pendientes"
      className="flex items-center gap-2.5 text-[17px] font-bold tracking-tight text-ink"
    >
      <Image src="/marca.png" alt="" width={28} height={28} className="rounded-[7px]" />
      Yunque
    </Link>
  );
}

export function Sidebar({ state }: { readonly state: ShellState }) {
  const pathname = usePathname();
  const health = HEALTH[state.health];
  // El menú se abre para la ruta actual: al navegar a otra, queda cerrado sin un efecto.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);

  // Menú abierto en el teléfono: el foco entra al menú, Esc lo cierra desde donde esté el
  // foco, y al cerrar el foco vuelve al botón "Menú".
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpenOn(null);
    };
    document.addEventListener("keydown", onKeyDown);
    const button = menuButton.current;
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      button?.focus();
    };
  }, [open]);

  // Tab no sale del menú abierto: del último elemento vuelve al primero y al revés.
  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!open || event.key !== "Tab" || !drawer.current) return;
    const focusable = drawer.current.querySelectorAll<HTMLElement>("a[href], button");
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
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-shell px-4 lg:hidden">
        <Brand />
        <div className="flex items-center gap-3 text-[12px]">
          {state.pendingCount > 0 ? (
            <Link href="/pendientes" className="font-medium text-ink">
              {state.pendingCount} pendientes
            </Link>
          ) : null}
          <button
            ref={menuButton}
            type="button"
            aria-expanded={open}
            aria-controls="menu-principal"
            onClick={() => setOpenOn(open ? null : pathname)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-control px-2.5 font-medium text-ink"
          >
            <MenuIcon />
            Menú
          </button>
        </div>
      </header>
      {open ? (
        <div
          aria-hidden="true"
          onClick={() => setOpenOn(null)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      ) : null}
      <aside
        id="menu-principal"
        ref={drawer}
        aria-modal={open ? true : undefined}
        role={open ? "dialog" : undefined}
        aria-label={open ? "Menú principal" : undefined}
        onKeyDown={trapFocus}
        className={`${open ? "fixed inset-y-0 left-0 z-40 flex w-64 shadow-lg" : "hidden"} shrink-0 flex-col border-r border-line bg-shell lg:static lg:flex lg:w-60 lg:shadow-none`}
      >
        <div className="flex items-start justify-between gap-2 px-4 pt-5 pb-4">
          <div className="min-w-0">
            <Brand />
            <p className="mt-0.5 truncate pl-[38px] text-[12px] text-ink-3">
              {state.organizationName}
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setOpenOn(null)}
            className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-ink-2 hover:bg-surface-hover lg:hidden"
          >
            <CloseIcon />
          </button>
        </div>
        <nav aria-label="Secciones" className="flex-1 px-3">
          <ul className="space-y-0.5">
            {NAV_ITEMS.filter((item) => state.demo || !item.demoOnly).map(
              ({ href, label, Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex h-9 items-center gap-2.5 rounded-[8px] px-3 text-[14px] ${
                        active
                          ? "bg-brand-tint font-semibold text-brand"
                          : "text-ink-2 hover:bg-surface-hover hover:text-ink"
                      }`}
                    >
                      <Icon />
                      <span className="flex-1">{label}</span>
                      {href === "/pendientes" && state.pendingCount > 0 ? (
                        <span
                          aria-label={`${String(state.pendingCount)} esperan decisión`}
                          className={`num rounded-full px-2 font-mono text-[11px] font-semibold ${
                            active ? "bg-brand text-on-brand" : "bg-surface-hover text-ink"
                          }`}
                        >
                          {state.pendingCount}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              },
            )}
          </ul>
        </nav>
        <div className="mx-3 border-t border-line px-2 pt-4 pb-4">
          <p className="caps mb-2.5">Controles</p>
          <dl className="space-y-3 text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-ink-2">Pagos</dt>
              <dd
                className={`inline-flex items-center gap-1.5 font-semibold ${state.controls.payments_enabled ? "text-ink" : "text-hold"}`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${state.controls.payments_enabled ? "bg-pay-solid" : "bg-hold-solid"}`}
                />
                {state.controls.payments_enabled ? "Encendidos" : "Apagados"}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-2">Agente</dt>
              <dd className="font-semibold text-ink">
                {state.controls.autonomy === "decidir" ? "Decide" : "Solo recomienda"}
              </dd>
            </div>
            {state.controls.dry_run ? (
              <div className="flex items-center justify-between">
                <dt className="text-ink-2">Prueba</dt>
                <dd className="font-semibold text-ink">Sin órdenes reales</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <dt className="text-ink-2">Salud</dt>
              <dd>
                <Link
                  href="/salud"
                  className="inline-flex items-center gap-1.5 font-semibold text-ink hover:underline"
                >
                  <span aria-hidden="true" className={`size-1.5 rounded-full ${health.dot}`} />
                  {health.label}
                </Link>
              </dd>
            </div>
          </dl>
          <div className="mt-4 space-y-2">
            {state.demo ? (
              <button
                type="button"
                onClick={() => {
                  setOpenOn(null);
                  window.dispatchEvent(new Event(TOUR_OPEN_EVENT));
                }}
                className="flex h-9 w-full items-center gap-2 rounded-[var(--radius-control)] px-3 text-[13px] text-ink-2 hover:bg-surface-hover hover:text-ink"
              >
                <PlayIcon />
                Ver el recorrido
              </button>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}
