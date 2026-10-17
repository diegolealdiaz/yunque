"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Controls } from "@/src/domain";

import { ChartIcon, InboxIcon, ListIcon, LogIcon, RulesIcon } from "./icons";

/**
 * Barra lateral (docs/interfaz.md §4): cinco destinos en orden de uso y, abajo, el estado
 * de los controles y la salud. Están siempre a la vista porque son el argumento de
 * seguridad del producto: cualquiera ve si los pagos están encendidos y en qué modo decide.
 */

export type HealthLevel = "ok" | "degradada" | "caida";

export type ShellState = {
  readonly organizationName: string;
  /** Facturas que esperan decisión de una persona. */
  readonly pendingCount: number;
  readonly controls: Controls;
  readonly health: HealthLevel;
};

export const NAV_ITEMS = [
  { href: "/pendientes", label: "Pendientes", Icon: InboxIcon, shortcut: "p" },
  { href: "/facturas", label: "Facturas", Icon: ListIcon, shortcut: "f" },
  { href: "/reglas", label: "Reglas", Icon: RulesIcon, shortcut: "r" },
  { href: "/metricas", label: "Métricas", Icon: ChartIcon, shortcut: "m" },
  { href: "/bitacora", label: "Bitácora", Icon: LogIcon, shortcut: "b" },
] as const;

const HEALTH: Readonly<Record<HealthLevel, { label: string; dot: string }>> = {
  ok: { label: "Salud: en orden", dot: "bg-pay-solid" },
  degradada: { label: "Salud: degradada", dot: "bg-escalate-solid" },
  caida: { label: "Salud: con fallas", dot: "bg-hold-solid" },
};

export function Sidebar({ state }: { readonly state: ShellState }) {
  const pathname = usePathname();
  const health = HEALTH[state.health];
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="px-4 pt-5 pb-4">
        <Link href="/pendientes" className="text-[16px] font-semibold tracking-tight text-ink">
          Yunque
        </Link>
        <p className="mt-0.5 truncate text-[12px] text-ink-3">{state.organizationName}</p>
      </div>
      <nav aria-label="Secciones" className="flex-1 px-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-[13px] ${
                    active
                      ? "bg-surface-sunken font-medium text-ink"
                      : "text-ink-2 hover:bg-surface-hover hover:text-ink"
                  }`}
                >
                  <Icon />
                  <span className="flex-1">{label}</span>
                  {href === "/pendientes" && state.pendingCount > 0 ? (
                    <span
                      aria-label={`${String(state.pendingCount)} esperan decisión`}
                      className="num rounded-full bg-escalate-tint px-1.5 text-[11px] font-semibold text-escalate"
                    >
                      {state.pendingCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <dl className="space-y-1.5 border-t border-line px-4 py-4 text-[12px]">
        <div className="flex justify-between">
          <dt className="text-ink-3">Pagos</dt>
          <dd
            className={`font-medium ${state.controls.payments_enabled ? "text-ink" : "text-hold"}`}
          >
            {state.controls.payments_enabled ? "Encendidos" : "Apagados"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">Modo</dt>
          <dd className="font-medium text-ink">
            {state.controls.autonomy === "decidir" ? "Decidir" : "Recomendar"}
          </dd>
        </div>
        {state.controls.dry_run ? (
          <div className="flex justify-between">
            <dt className="text-ink-3">Prueba</dt>
            <dd className="font-medium text-ink">Sin órdenes reales</dd>
          </div>
        ) : null}
        <div className="pt-1">
          <dt className="sr-only">Salud</dt>
          <dd>
            <Link
              href="/salud"
              className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink"
            >
              <span aria-hidden="true" className={`size-2 rounded-full ${health.dot}`} />
              {health.label}
            </Link>
          </dd>
        </div>
      </dl>
    </aside>
  );
}
