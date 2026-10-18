"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { TOUR_OPEN_EVENT, TOUR_SEEN_KEY, TOUR_STEPS } from "@/src/ui/tour";

/**
 * Recorrido guiado (docs/interfaz.md §5.9): la primera vez que alguien entra, cuatro pasos
 * sobre pantallas reales. Cada paso lleva a su pantalla, enmarca lo que señala y oscurece lo
 * demás; la tarjeta se pone debajo, encima o en una esquina, donde quepa. Por su cuenta se
 * abre solo en las pantallas de entrada. Se salta con
 * "Saltar" o Esc y no vuelve a salir; "Ver el recorrido" en la barra lo abre de nuevo.
 */

type Box = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

/** Espera antes de abrir el recorrido la primera vez. */
const FIRST_DELAY_MS = 600;

/**
 * Pantallas donde se abre solo: las de entrada. Quien llega por un enlace directo (una
 * factura desde un aviso) ve lo que pidió; el recorrido queda en "Ver el recorrido".
 */
const AUTO_OPEN_ROUTES: ReadonlySet<string> = new Set(["/probar", "/pendientes"]);

/**
 * Cuánto se espera a que aparezca lo que señala un paso. La primera visita crea la empresa de
 * ejemplo y la pantalla tarda en llegar: mientras tanto la tarjeta no se muestra sobre el
 * esqueleto de carga. Pasado este tiempo sale igual, en una esquina.
 */
const ANCHOR_WAIT_MS = 10_000;

/** Lo que mide la tarjeta, para decidir dónde cabe. */
const CARD = { width: 352, height: 230, gap: 12, margin: 16 } as const;

function seen(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === "visto";
  } catch {
    // Sin almacenamiento (ventana privada estricta), no se insiste: se da por visto.
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, "visto");
  } catch {
    // Sin almacenamiento, el recorrido simplemente no se recuerda.
  }
}

/** Dónde va la tarjeta: debajo de lo señalado, encima, o en la esquina si no cabe. */
function cardPosition(box: Box | null): React.CSSProperties {
  const { innerWidth: w, innerHeight: h } = window;
  if (!box || w < 640) return { left: CARD.margin, right: CARD.margin, bottom: CARD.margin };
  const left = Math.min(Math.max(box.left, CARD.margin), w - CARD.width - CARD.margin);
  if (box.top + box.height + CARD.gap + CARD.height < h) {
    return { left, top: box.top + box.height + CARD.gap, width: CARD.width };
  }
  if (box.top - CARD.gap - CARD.height > CARD.margin) {
    return { left, top: box.top - CARD.gap - CARD.height, width: CARD.width };
  }
  return { right: CARD.margin * 1.5, bottom: CARD.margin * 1.5, width: CARD.width };
}

export function GuidedTour() {
  const router = useRouter();
  const pathname = usePathname();
  const titleId = useId();
  const card = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  // El paso cuya búsqueda ya terminó (encontró lo que señala o se agotó la espera).
  const [located, setLocated] = useState<string | null>(null);
  const current = step === null ? null : (TOUR_STEPS[step] ?? null);

  const close = useCallback(() => {
    markSeen();
    setStep(null);
    setBox(null);
    setLocated(null);
  }, []);

  // La primera vez, y cada vez que se pide desde la barra.
  // La primera vez se espera un momento, para que la pantalla se vea antes que el recorrido.
  useEffect(() => {
    const first = window.setTimeout(() => {
      if (!seen() && AUTO_OPEN_ROUTES.has(window.location.pathname)) setStep(0);
    }, FIRST_DELAY_MS);
    const open = () => setStep(0);
    window.addEventListener(TOUR_OPEN_EVENT, open);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener(TOUR_OPEN_EVENT, open);
    };
  }, []);

  // Lleva a la pantalla del paso.
  useEffect(() => {
    if (current && pathname !== current.route) router.push(current.route);
  }, [current, pathname, router]);

  // Busca lo que señala el paso, lo trae a la vista y sigue su posición.
  useEffect(() => {
    if (!current || pathname !== current.route) return;
    let frame = 0;
    const started = performance.now();
    let target: Element | null = null;
    const measure = () => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      const top = Math.max(r.top, 8);
      const bottom = Math.min(r.bottom, window.innerHeight - 8);
      setBox({ top, left: r.left, width: r.width, height: Math.max(0, bottom - top) });
    };
    const find = () => {
      target = document.querySelector(`[data-tour="${current.anchor}"]`);
      if (!target && performance.now() - started < ANCHOR_WAIT_MS) {
        frame = requestAnimationFrame(find);
        return;
      }
      setLocated(current.route);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Margen arriba, para que el marco no quede pegado al borde de la pantalla.
      if (target instanceof HTMLElement) target.style.scrollMarginTop = "24px";
      target?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      measure();
    };
    find();
    // El contenido se desplaza dentro de `main`: se escucha en captura para enterarse.
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, [current, pathname]);

  // La tarjeta toma el foco cuando aparece, para seguir con el teclado y que se lea.
  useEffect(() => {
    if (current && located === current.route) card.current?.focus();
  }, [current, located]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, close]);

  if (step === null || !current || located !== current.route) return null;
  const last = step === TOUR_STEPS.length - 1;

  return (
    <>
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-40 rounded-[var(--radius-card)] ring-2 ring-brand transition-all duration-300 motion-reduce:transition-none"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)",
          }}
        />
      ) : null}
      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed z-50 card p-5 shadow-xl outline-none"
        style={cardPosition(box)}
      >
        <p className="caps text-brand">
          Paso {step + 1} de {TOUR_STEPS.length}
        </p>
        <p id={titleId} className="mt-1.5 text-[17px] font-semibold text-ink">
          {current.title}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{current.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={close}
            className="mr-auto text-[13px] text-ink-3 underline-offset-4 hover:text-ink hover:underline"
          >
            Saltar
          </button>
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px] text-ink"
            >
              Anterior
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => (last ? close() : setStep(step + 1))}
            className="h-8 btn-primary px-3 text-[13px]"
          >
            {last ? "Listo" : "Siguiente"}
          </button>
        </div>
      </div>
    </>
  );
}
