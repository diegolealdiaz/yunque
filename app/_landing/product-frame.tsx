import Image from "next/image";

import {
  ChevronIcon,
  InboxIcon,
  ListIcon,
  LogIcon,
  RulesIcon,
  ChartIcon,
} from "../_components/icons";
import { VerdictChip } from "../_components/verdict-chip";

import { Eyebrow } from "./sections";

/**
 * La bandeja de Pendientes dentro de una ventana, en la portada. En escritorio la sección es
 * más alta que la pantalla y la ventana queda fija: al bajar crece de 0,84 a 1 y sus filas
 * aparecen (app/_landing/motion.tsx). En el teléfono es una imagen quieta del producto.
 * Es una maqueta con datos de ejemplo escritos aquí: no lee la base.
 */

const NAV = [
  { label: "Pendientes", Icon: InboxIcon, count: 3 },
  { label: "Facturas", Icon: ListIcon, count: null },
  { label: "Reglas", Icon: RulesIcon, count: null },
  { label: "Métricas", Icon: ChartIcon, count: null },
  { label: "Bitácora", Icon: LogIcon, count: null },
] as const;

const ROWS = [
  {
    payee: "Andes Hardware SAS",
    ref: "AH-5560",
    amount: "25.000.000 COP",
    due: "31 oct",
    why: "Supera el umbral",
  },
  {
    payee: "Soluciones Cloud SAS",
    ref: "SC-0001",
    amount: "3.200.000 COP",
    due: "29 oct",
    why: "No está en tu lista",
  },
  {
    payee: "Camila Rojas",
    ref: "CR-120",
    amount: "10.000.000 COP",
    due: "31 oct",
    why: "No cuadra con lo acordado",
  },
] as const;

export function ProductFrame() {
  return (
    <section
      data-frame
      aria-labelledby="producto-titulo"
      className="relative -mx-4 sm:-mx-6 md:h-[210vh]"
    >
      <div className="flex flex-col justify-center gap-8 px-4 sm:px-6 md:sticky md:top-16 md:h-[calc(100vh-4rem)]">
        <div data-reveal className="text-center">
          <Eyebrow>El producto</Eyebrow>
          <h2
            id="producto-titulo"
            data-reveal-title
            className="mx-auto mt-5 max-w-3xl text-[30px] leading-[1.12] font-bold tracking-tight text-ink sm:text-[44px]"
          >
            Tu bandeja trae solo lo que necesita a una persona.
          </h2>
        </div>

        <div
          data-frame-panel
          aria-hidden="true"
          className="card mx-auto w-full max-w-5xl origin-top overflow-hidden"
        >
          <div className="flex h-9 items-center gap-2 border-b border-line bg-shell px-4">
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="ml-3 font-mono text-[11px] text-ink-3">yunque · pendientes</span>
          </div>
          <div className="grid md:grid-cols-[190px_1fr]">
            <div className="hidden flex-col gap-1 border-r border-line bg-shell p-3 md:flex">
              <span className="mb-3 flex items-center gap-2 px-2 pt-1 text-[14px] font-bold text-ink">
                <Image src="/marca.png" alt="" width={20} height={20} className="rounded-[5px]" />
                Yunque
              </span>
              {NAV.map(({ label, Icon, count }, i) => (
                <span
                  key={label}
                  className={`flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-[12px] ${
                    i === 0 ? "bg-brand-tint font-semibold text-brand" : "text-ink-2"
                  }`}
                >
                  <Icon />
                  <span className="flex-1">{label}</span>
                  {count ? (
                    <span className="rounded-full bg-brand px-1.5 font-mono text-[10px] font-semibold text-on-brand">
                      {count}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
            <div className="p-5 sm:p-7">
              <p className="caps">Pendientes · hoy</p>
              <p className="mt-2 flex items-baseline gap-3">
                <span className="num font-mono text-[44px] leading-none font-bold tracking-tight text-ink">
                  3
                </span>
                <span className="text-[15px] font-medium text-ink-2">esperan tu decisión</span>
              </p>
              <div className="mt-6 overflow-hidden rounded-[12px] border border-line">
                <div className="caps hidden grid-cols-[1.3fr_0.9fr_0.7fr_2fr_auto] gap-4 border-b border-line px-4 py-2.5 sm:grid">
                  <span>Beneficiario</span>
                  <span className="text-right">Monto</span>
                  <span>Vence</span>
                  <span>Veredicto</span>
                  <span className="w-14" />
                </div>
                {ROWS.map((row) => (
                  <div
                    key={row.ref}
                    data-frame-row
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 text-[13px] last:border-b-0 sm:grid-cols-[1.3fr_0.9fr_0.7fr_2fr_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{row.payee}</span>
                      <span className="font-mono text-[11px] text-ink-3">{row.ref}</span>
                    </span>
                    <span className="num text-right font-mono text-ink">{row.amount}</span>
                    <span className="hidden text-ink-2 sm:block">{row.due}</span>
                    <span className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
                      <VerdictChip verdict="escalar" />
                      <span className="text-[12px] text-ink-2">{row.why}</span>
                    </span>
                    <span className="hidden w-14 items-center justify-end gap-0.5 font-medium text-ink sm:flex">
                      Revisar
                      <ChevronIcon />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
