"use client";

import Image from "next/image";
import { useEffect, useId, useState } from "react";

/**
 * El producto, en capturas reales de la demo (public/producto, generadas desde la app con el
 * lote de ejemplo procesado). Una pestaña por pantalla, cada una con lo que resuelve. Avanza
 * sola cada pocos segundos, con una barra de progreso en la pestaña activa; se detiene bajo el
 * puntero, con el foco dentro, con la pestaña del navegador oculta o con "reducir movimiento".
 * Las flechas del teclado cambian de pestaña, como en cualquier lista de pestañas.
 */

/** Cuánto se queda cada pantalla antes de pasar a la siguiente. */
const ADVANCE_MS = 6000;

const SCREENS = [
  {
    id: "pendientes",
    tab: "Pendientes",
    title: "Solo lo que necesita a una persona",
    body: "El agente paga por su cuenta lo que cumple tus reglas. Aquí llega lo demás, ordenado por vencimiento y con el motivo a la vista.",
    alt: "Pendientes: nueve facturas esperan una decisión, cada una con su veredicto y su motivo",
  },
  {
    id: "por-que",
    tab: "El porqué",
    title: "Cada decisión, explicada",
    body: "En palabras simples: qué decidió el agente, qué regla lo llevó a eso y qué puedes hacer. Al lado, el documento y cada dato con su lectura.",
    alt: "Detalle de una factura frenada porque la cuenta bancaria cambió, con la explicación y los datos leídos",
  },
  {
    id: "decision",
    tab: "Tu decisión",
    title: "Aprobar es un acto, no un clic",
    body: "Eliges quién firma, marcas lo que verificaste y la firma cubre el monto, la cuenta y el documento exactos. Con la doble firma, otra persona confirma.",
    alt: "Panel de decisión con quién resuelve, la lista de verificación y el botón de aprobar",
  },
  {
    id: "reglas",
    tab: "Reglas",
    title: "Tus reglas mandan",
    body: "Límites, presupuesto, beneficiarios y qué hacer en cada caso. Cuatro interruptores: pagos, modo de prueba, autonomía y doble firma.",
    alt: "Reglas con los cuatro interruptores, el umbral de aprobación y los límites de la política",
  },
  {
    id: "metricas",
    tab: "Métricas",
    title: "Medido, no prometido",
    body: "Cuánto decide solo el agente, cuántos pagos indebidos hubo (cero), cuánto cuesta y cuánto tarda cada factura.",
    alt: "Métricas: autonomía, cero falsos pagar, exactitud por campo, costo y tiempo por factura",
  },
  {
    id: "bitacora",
    tab: "Bitácora",
    title: "Todo queda escrito",
    body: "Cada paso del agente y de tu equipo, en orden, con quién lo hizo y por qué. Nadie puede editarlo ni borrarlo.",
    alt: "Bitácora con los eventos del agente y de las personas, en orden",
  },
] as const;

export function ProductShowcase() {
  const base = useId();
  const [active, setActive] = useState(0);
  // Bajo el puntero o con el foco dentro, no avanza: quien mira decide.
  const [held, setHeld] = useState(false);
  // Avanza solo si quien la ve no pidió menos movimiento; se decide al montar, en el navegador.
  const [auto, setAuto] = useState(false);
  const screen = SCREENS[active] ?? SCREENS[0];

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAuto(!query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!auto || held) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") setActive((i) => (i + 1) % SCREENS.length);
    }, ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [auto, held, active]);
  const select = (i: number) => {
    const next = (i + SCREENS.length) % SCREENS.length;
    setActive(next);
    document.getElementById(`${base}-tab-${String(next)}`)?.focus();
  };
  return (
    <div
      data-reveal-item
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false);
      }}
    >
      <div
        role="tablist"
        aria-label="Pantallas del producto"
        className="mx-auto flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") select(active + 1);
          else if (e.key === "ArrowLeft") select(active - 1);
        }}
      >
        {SCREENS.map((s, i) => (
          <button
            key={s.id}
            id={`${base}-tab-${String(i)}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={`relative h-9 shrink-0 overflow-hidden rounded-full px-4 text-[13px] font-medium whitespace-nowrap transition-colors ${
              i === active ? "bg-brand text-on-brand" : "text-ink-2 hover:text-ink"
            }`}
          >
            {s.tab}
            {/* Al pausar se oculta; al seguir, arranca de cero, igual que el temporizador. */}
            {i === active && auto && !held ? (
              <span
                key={`${String(active)}-progreso`}
                aria-hidden="true"
                className="tab-progress absolute inset-x-3 bottom-1 h-0.5 origin-left rounded-full bg-on-brand/70"
                style={{ animationDuration: `${String(ADVANCE_MS)}ms` }}
              />
            ) : null}
          </button>
        ))}
      </div>

      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-tab-${String(active)}`}
        className="mt-8"
      >
        <div key={`${screen.id}-texto`} className="showcase-in mx-auto max-w-2xl text-center">
          <h3 className="text-[22px] font-bold tracking-tight text-ink">{screen.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{screen.body}</p>
        </div>
        <figure
          data-tilt
          className="mt-8 overflow-hidden rounded-[16px] border border-line bg-surface shadow-2xl shadow-black/10"
        >
          <div
            aria-hidden="true"
            className="flex items-center gap-1.5 border-b border-line bg-surface-sunken px-4 py-2.5"
          >
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="ml-3 font-mono text-[11px] text-ink-3">
              yunque · {screen.tab.toLowerCase()}
            </span>
          </div>
          <Image
            key={screen.id}
            src={`/producto/${screen.id}.webp`}
            alt={screen.alt}
            width={1600}
            height={1000}
            sizes="(min-width: 1152px) 1104px, 100vw"
            className="showcase-in block h-auto w-full"
          />
        </figure>
      </div>
    </div>
  );
}
