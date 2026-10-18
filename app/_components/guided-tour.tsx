"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { TOUR_INVOICE_ROUTE, TOUR_OPEN_EVENT, TOUR_SEEN_KEY, TOUR_STEPS } from "@/src/ui/tour";

import { tourInvoice } from "../_actions/tour";
import { VerdictPill } from "./verdict-pill";

/**
 * Recorrido guiado (docs/interfaz.md §5.9): la primera vez que alguien entra, diez pasos
 * sobre pantallas reales. La bienvenida va centrada y da el vocabulario; cada paso siguiente
 * lleva a su pantalla, enmarca lo que señala y oscurece lo demás, con la tarjeta debajo,
 * encima o en una esquina, donde quepa. Los pasos del detalle abren una factura de la
 * empresa del visitante. Se avanza con los botones o las flechas, se sale con "Saltar" o Esc,
 * y "Ver el recorrido" en la barra lo abre de nuevo. Por su cuenta solo se abre en las
 * pantallas de entrada; nunca cambia datos.
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
const CARD = { width: 372, height: 250, gap: 12, margin: 16 } as const;

/** Los tres veredictos, como los presenta la bienvenida. */
const VERDICTS = [
  { verdict: "pagar", text: "cumple todas tus reglas y se paga solo" },
  { verdict: "escalar", text: "algo pide criterio: la decide una persona" },
  { verdict: "frenar", text: "algo no cuadra o es sospechoso: no se paga" },
] as const;

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

/** Dónde va la tarjeta: centrada sin marco, o debajo, encima o en la esquina de lo señalado. */
function cardPosition(box: Box | null, centered: boolean): React.CSSProperties {
  const { innerWidth: w, innerHeight: h } = window;
  if (centered) {
    return w < 640
      ? { left: CARD.margin, right: CARD.margin, top: "50%", transform: "translateY(-50%)" }
      : { left: "50%", top: "50%", width: 460, transform: "translate(-50%, -50%)" };
  }
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
  // Hacia dónde se movió por última vez: si un paso no se puede mostrar, se sigue de largo.
  const [direction, setDirection] = useState<1 | -1>(1);
  const [box, setBox] = useState<Box | null>(null);
  // El paso cuya búsqueda ya terminó (encontró lo que señala o se agotó la espera).
  const [located, setLocated] = useState<number | null>(null);
  // La factura de ejemplo de los pasos del detalle: undefined mientras no se pidió.
  const [invoice, setInvoice] = useState<string | null | undefined>(undefined);
  const current = step === null ? null : (TOUR_STEPS[step] ?? null);
  const route =
    current?.route === TOUR_INVOICE_ROUTE
      ? invoice
        ? `/facturas/${invoice}`
        : null
      : (current?.route ?? null);

  const close = useCallback(() => {
    markSeen();
    setStep(null);
    setBox(null);
    setLocated(null);
  }, []);
  const go = useCallback(
    (to: number) => {
      const dir = to < (step ?? 0) ? -1 : 1;
      // Sin factura de ejemplo, los pasos del detalle se pasan de largo.
      let target = to;
      while (invoice === null && TOUR_STEPS[target]?.route === TOUR_INVOICE_ROUTE) target += dir;
      setDirection(dir);
      setBox(null);
      if (target < 0 || target >= TOUR_STEPS.length) close();
      else setStep(target);
    },
    [step, invoice, close],
  );

  // La primera vez, y cada vez que se pide desde la barra.
  // La primera vez se espera un momento, para que la pantalla se vea antes que el recorrido.
  useEffect(() => {
    const first = window.setTimeout(() => {
      if (!seen() && AUTO_OPEN_ROUTES.has(window.location.pathname)) setStep(0);
    }, FIRST_DELAY_MS);
    const open = () => {
      setDirection(1);
      setStep(0);
    };
    window.addEventListener(TOUR_OPEN_EVENT, open);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener(TOUR_OPEN_EVENT, open);
    };
  }, []);

  // Los pasos del detalle necesitan una factura: se pide una vez, al llegar al primero.
  useEffect(() => {
    if (current?.route !== TOUR_INVOICE_ROUTE || invoice !== undefined) return;
    let alive = true;
    // Sin factura que mostrar, se sigue en la dirección en que se iba.
    const skip = () => {
      setInvoice(null);
      setStep((s) => {
        if (s === null) return null;
        let next = s;
        while (TOUR_STEPS[next]?.route === TOUR_INVOICE_ROUTE) next += direction;
        return next >= 0 && next < TOUR_STEPS.length ? next : null;
      });
    };
    tourInvoice()
      .then((id) => {
        if (!alive) return;
        if (id) setInvoice(id);
        else skip();
      })
      .catch(() => {
        if (alive) skip();
      });
    return () => {
      alive = false;
    };
  }, [current, invoice, direction]);

  // Lleva a la pantalla del paso.
  useEffect(() => {
    if (route && pathname !== route) router.push(route);
  }, [route, pathname, router]);

  // Busca lo que señala el paso, lo trae a la vista y sigue su posición.
  useEffect(() => {
    if (step === null || !current || !route || pathname !== route || current.anchor === null)
      return;
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
      target = document.querySelector(`[data-tour="${current.anchor ?? ""}"]`);
      if (!target && performance.now() - started < ANCHOR_WAIT_MS) {
        frame = requestAnimationFrame(find);
        return;
      }
      setLocated(step);
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
  }, [step, current, route, pathname]);

  // La bienvenida, sin nada que señalar, está lista apenas su pantalla carga.
  const ready =
    step !== null &&
    current !== null &&
    (current.anchor === null ? route !== null && pathname === route : located === step);

  // La tarjeta toma el foco cuando aparece, para seguir con el teclado y que se lea.
  useEffect(() => {
    if (ready) card.current?.focus();
  }, [ready, step]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" && step < TOUR_STEPS.length - 1) go(step + 1);
      else if (e.key === "ArrowLeft" && step > 0) go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, close, go]);

  if (step === null || !current || !ready) return null;
  const last = step === TOUR_STEPS.length - 1;
  const centered = current.anchor === null;

  return (
    <>
      {centered ? (
        <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/45" />
      ) : box ? (
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
        style={cardPosition(box, centered)}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="caps text-brand">
            Paso {step + 1} de {TOUR_STEPS.length}
          </p>
          <div aria-hidden="true" className="flex gap-1">
            {TOUR_STEPS.map((s, i) => (
              <span
                key={`${s.route}-${String(i)}`}
                className={`h-1 w-3 rounded-full ${i <= step ? "bg-brand" : "bg-line-strong"}`}
              />
            ))}
          </div>
        </div>
        <p
          id={titleId}
          className={`mt-2 font-semibold text-ink ${centered ? "text-[20px]" : "text-[17px]"}`}
        >
          {current.title}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{current.body}</p>

        {current.extra === "veredictos" ? (
          <ul className="mt-3 space-y-2">
            {VERDICTS.map((v) => (
              <li key={v.verdict} className="flex items-center gap-3 text-[13px] text-ink-2">
                <span className="w-24 shrink-0">
                  <VerdictPill verdict={v.verdict} />
                </span>
                {v.text}
              </li>
            ))}
          </ul>
        ) : null}

        {current.extra === "acciones" ? (
          <div className="mt-4 grid gap-2">
            <Link
              href="/facturas"
              onClick={close}
              className="inline-flex h-9 items-center justify-center btn-primary px-3 text-[13px]"
            >
              Procesar las 33 de ejemplo
            </Link>
            <Link
              href="/probar"
              onClick={close}
              className="inline-flex h-9 items-center justify-center rounded-[var(--radius-control)] border border-control px-3 text-[13px] font-medium text-ink"
            >
              Probar con mi factura
            </Link>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={close}
            className="mr-auto text-[13px] text-ink-3 underline-offset-4 hover:text-ink hover:underline"
          >
            {last ? "Cerrar" : "Saltar"}
          </button>
          {step > 0 ? (
            <button
              type="button"
              onClick={() => go(step - 1)}
              className="h-8 rounded-[var(--radius-control)] border border-control px-3 text-[13px] text-ink"
            >
              Anterior
            </button>
          ) : null}
          {last ? null : (
            <button
              type="button"
              onClick={() => go(step + 1)}
              className="h-8 btn-primary px-3 text-[13px]"
            >
              {step === 0 ? "Empezar" : "Siguiente"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
