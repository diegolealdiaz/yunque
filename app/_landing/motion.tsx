"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useRef, type ReactNode } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText);

/**
 * Movimiento de la portada (docs/interfaz.md §11). Las secciones son del servidor y marcan
 * con atributos qué se anima; aquí se arma todo con GSAP dentro de un solo ámbito:
 *
 * - `data-intro`: la entrada, en orden (barra, titular por líneas con máscara, texto,
 *   botones y la captura del producto).
 * - `data-question`: las preguntas del panel de control se turnan en una píldora.
 * - `data-reveal`: cada sección entra una vez; `data-count-to`: cifras que cuentan.
 * - `data-pop` y `.spotlight`: botones que crecen bajo el puntero y tarjetas con una luz que
 *   lo sigue. `data-nav`: la barra es transparente arriba del todo.
 *
 * Con "reducir movimiento" no se anima nada y todo queda en su estado final, que es el mismo
 * con o sin animación. Se animan transform y opacidad.
 */

/** Lo que una animación deja en línea y hay que limpiar al terminar. */
const CLEAR = "transform,opacity,visibility";

function intro(scope: HTMLElement): void {
  const q = (name: string) => scope.querySelectorAll<HTMLElement>(`[data-intro="${name}"]`);
  const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
  tl.fromTo(
    q("nav"),
    { autoAlpha: 0, y: -16 },
    { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.07 },
    0,
  )
    .fromTo(q("eyebrow"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.1)
    .fromTo(
      q("line"),
      { yPercent: 110, autoAlpha: 1 },
      { yPercent: 0, autoAlpha: 1, duration: 1.1, stagger: 0.12 },
      0.2,
    )
    .fromTo(q("lead"), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.55)
    .fromTo(
      q("cta"),
      { autoAlpha: 0, y: 14 },
      { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.08 },
      0.7,
    )
    .fromTo(q("frame"), { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 1.4 }, 0.8);
  // Al terminar, nada queda en línea y se levanta el velo de antes de hidratar
  // (`data-motion`, ver src/ui/theme.ts): el estado final es el del HTML.
  tl.eventCallback("onComplete", () => {
    document.documentElement.dataset["motion"] = "done";
    gsap.set(scope.querySelectorAll("[data-intro]"), { clearProps: CLEAR });
  });
}

/** Las luces del fondo se mueven despacio, de ida y vuelta. */
function auroras(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLElement>("[data-aurora]").forEach((light, i) => {
    gsap.to(light, {
      xPercent: i % 2 === 0 ? 14 : -12,
      yPercent: i % 2 === 0 ? 10 : 16,
      duration: 9 + i * 2,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
  });
}

/**
 * La barra es transparente arriba del todo y toma fondo y borde al bajar. Se lee la posición
 * del scroll en cada evento: un disparador con fin se apagaría al llegar al final de la página.
 */
function navState(scope: HTMLElement): () => void {
  const header = scope.querySelector<HTMLElement>("[data-nav]");
  if (!header) return () => undefined;
  const update = () => {
    header.dataset["top"] = String(window.scrollY < 8);
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
  return () => {
    window.removeEventListener("scroll", update);
    delete header.dataset["top"];
  };
}

/** Las preguntas del panel de control se turnan: la que sale sube, la que entra viene de abajo. */
function questions(scope: HTMLElement): void {
  const items = [...scope.querySelectorAll<HTMLElement>("[data-question]")];
  if (items.length < 2) return;
  gsap.set(items.slice(1), { autoAlpha: 0, yPercent: 100 });
  const tl = gsap.timeline({ repeat: -1, paused: true });
  items.forEach((item, i) => {
    const next = items[(i + 1) % items.length];
    tl.to(item, { yPercent: -100, autoAlpha: 0, duration: 0.6, ease: "power3.inOut" }, "+=1.8");
    if (next) {
      tl.fromTo(
        next,
        { yPercent: 100, autoAlpha: 0 },
        // Sin pintar al crear: la última vuelta trae de nuevo la primera, que debe verse ya.
        { yPercent: 0, autoAlpha: 1, duration: 0.6, ease: "power3.inOut", immediateRender: false },
        "<",
      );
    }
  });
  const first = items[0];
  ScrollTrigger.create({
    trigger: first?.parentElement ?? first,
    start: "top bottom",
    end: "bottom top",
    onToggle: (self) => {
      if (self.isActive) tl.play();
      else tl.pause();
    },
  });
}

function heroScroll(scope: HTMLElement): void {
  const hero = scope.querySelector<HTMLElement>("[data-hero-scroll]");
  if (!hero) return;
  gsap.to(hero.querySelectorAll("[data-hero-copy]"), {
    y: -80,
    autoAlpha: 0.1,
    ease: "none",
    scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 },
  });
}

function reveals(scope: HTMLElement): void {
  for (const section of scope.querySelectorAll<HTMLElement>("[data-reveal]")) {
    const title = section.querySelector<HTMLElement>("[data-reveal-title]");
    const lead = section.querySelector<HTMLElement>("[data-reveal-lead]");
    const items = section.querySelectorAll<HTMLElement>("[data-reveal-item]");
    const split = title ? SplitText.create(title, { type: "lines", mask: "lines" }) : null;
    const tl = gsap.timeline({
      paused: true,
      defaults: { ease: "expo.out" },
      onComplete: () => {
        split?.revert();
        const animated = [lead, ...items].filter((el): el is HTMLElement => el !== null);
        if (animated.length > 0) gsap.set(animated, { clearProps: CLEAR });
      },
    });
    if (split)
      tl.fromTo(split.lines, { yPercent: 105 }, { yPercent: 0, duration: 1.1, stagger: 0.1 }, 0);
    if (lead) tl.fromTo(lead, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.3);
    if (items.length > 0) {
      tl.fromTo(
        items,
        { autoAlpha: 0, y: 30, scale: 0.985 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.95, stagger: 0.09 },
        0.4,
      );
    }
    ScrollTrigger.create({
      trigger: section,
      start: "top 85%",
      once: true,
      onEnter: () => tl.play(),
    });
  }
}

function counts(scope: HTMLElement): void {
  for (const element of scope.querySelectorAll<HTMLElement>("[data-count-to]")) {
    const target = Number(element.dataset["countTo"]);
    const finalText = element.textContent;
    if (!Number.isFinite(target) || target <= 0) continue;
    const proxy = { value: 0 };
    gsap.to(proxy, {
      value: target,
      duration: 1.2,
      ease: "power3.out",
      scrollTrigger: { trigger: element, start: "top 85%", once: true },
      onStart: () => {
        element.textContent = "0";
      },
      onUpdate: () => {
        element.textContent = String(Math.round(proxy.value));
      },
      // El texto final es el del servidor, no el del cálculo.
      onComplete: () => {
        element.textContent = finalText;
      },
    });
  }
}

/** Crecer un poco bajo el puntero y volver más rápido, sin rebote, al salir. */
function hoverPops(scope: HTMLElement): () => void {
  const cleanups: (() => void)[] = [];
  for (const element of scope.querySelectorAll<HTMLElement>("[data-pop]")) {
    const scale = Number(element.dataset["pop"]) || 1.03;
    const pop = gsap.timeline({ paused: true }).to(element, {
      scale,
      duration: 0.6,
      ease: "elastic.out(1, 0.6)",
    });
    const enter = () => pop.timeScale(1).play();
    const leave = () => pop.timeScale(1.8).reverse();
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("blur", leave);
    cleanups.push(() => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("blur", leave);
      pop.kill();
      gsap.set(element, { clearProps: "transform" });
    });
  }
  // La luz de las tarjetas sigue al puntero (.spotlight en globals.css).
  for (const card of scope.querySelectorAll<HTMLElement>(".spotlight")) {
    const move = (event: PointerEvent) => {
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${String(event.clientX - box.left)}px`);
      card.style.setProperty("--my", `${String(event.clientY - box.top)}px`);
    };
    card.addEventListener("pointermove", move);
    cleanups.push(() => card.removeEventListener("pointermove", move));
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

export function LandingMotion({ children }: { readonly children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      const motion = "(prefers-reduced-motion: no-preference)";
      const offNav = navState(root);
      // Grupos separados: pasar de ancho a angosto no repite la entrada.
      mm.add(motion, () => {
        intro(root);
        auroras(root);
        questions(root);
        reveals(root);
        counts(root);
      });
      mm.add(`${motion} and (min-width: 768px)`, () => {
        heroScroll(root);
      });
      mm.add(`${motion} and (hover: hover) and (pointer: fine)`, () => hoverPops(root));
      // Las fuentes cambian la altura de las líneas: se recalculan los puntos de disparo.
      void document.fonts.ready.then(() => ScrollTrigger.refresh());
      return () => {
        mm.revert();
        offNav();
      };
    },
    { scope },
  );

  return (
    <div ref={scope} className="flex min-h-full flex-col overflow-x-clip">
      {children}
    </div>
  );
}
