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
 * - `data-intro`: la entrada del primer bloque, en orden (barra, titular por líneas con
 *   máscara, texto, botones, tarjeta de ejemplo, sus controles, veredicto y un brillo).
 * - `data-hero-scroll`: el primer bloque se aleja al bajar, y la tarjeta más rápido.
 * - `data-frame`: el producto crece de 0,84 a 1 en una sección fija mientras se lee.
 * - `data-reveal`: cada sección entra una vez al cruzar el 85 % de la pantalla: titular por
 *   líneas con máscara, el texto, y los `data-reveal-item` escalonados.
 * - `data-draw`: conectores que se dibujan; `data-count-to`: cifras que cuentan hasta su
 *   valor y terminan en el texto exacto que mandó el servidor.
 * - `data-pop`: botones y enlaces que crecen un poco bajo el puntero y vuelven sin rebote.
 *
 * Con "reducir movimiento" no se arma nada y todo queda en su estado final, que es el mismo
 * con o sin animación. Solo se animan transform y opacidad.
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
    .fromTo(
      q("card"),
      { autoAlpha: 0, y: 24, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 1.1, stagger: 0.12 },
      0.45,
    )
    .fromTo(
      q("check"),
      { autoAlpha: 0, x: -10 },
      { autoAlpha: 1, x: 0, duration: 0.6, stagger: 0.32 },
      0.95,
    )
    .fromTo(
      q("verdict"),
      { autoAlpha: 0, y: 10, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.8 },
      ">-0.1",
    )
    .fromTo(
      q("shine"),
      { xPercent: -110, autoAlpha: 1 },
      { xPercent: 240, duration: 1.1, ease: "power2.inOut" },
      ">-0.3",
    )
    .set(q("shine"), { autoAlpha: 0 });
  // Al terminar, nada queda en línea y se levanta el velo de antes de hidratar
  // (`data-motion`, ver src/ui/theme.ts): el estado final es el del HTML.
  tl.eventCallback("onComplete", () => {
    document.documentElement.dataset["motion"] = "done";
    gsap.set(scope.querySelectorAll("[data-intro]"), { clearProps: CLEAR });
  });
}

function heroScroll(scope: HTMLElement): void {
  const hero = scope.querySelector<HTMLElement>("[data-hero-scroll]");
  if (!hero) return;
  const trigger = { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 };
  gsap.to(hero.querySelectorAll("[data-hero-copy]"), {
    y: -60,
    autoAlpha: 0.15,
    ease: "none",
    scrollTrigger: trigger,
  });
  gsap.to(hero.querySelectorAll("[data-hero-card]"), {
    y: -120,
    ease: "none",
    scrollTrigger: trigger,
  });
}

function productFrame(scope: HTMLElement): void {
  const section = scope.querySelector<HTMLElement>("[data-frame]");
  const panel = section?.querySelector<HTMLElement>("[data-frame-panel]");
  if (!section || !panel) return;
  const rows = section.querySelectorAll<HTMLElement>("[data-frame-row]");
  const tl = gsap.timeline({
    scrollTrigger: { trigger: section, start: "top top", end: "bottom bottom", scrub: 0.5 },
  });
  // Primero crece; después aparecen las filas; al final una pausa sin cambios.
  tl.fromTo(
    panel,
    { scale: 0.84, borderRadius: 32 },
    { scale: 1, borderRadius: 16, duration: 0.5, ease: "none" },
    0,
  )
    .fromTo(
      rows,
      { autoAlpha: 0, y: 18 },
      { autoAlpha: 1, y: 0, duration: 0.25, stagger: 0.08, ease: "none" },
      0.3,
    )
    .to({}, { duration: 0.25 });
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

function draws(scope: HTMLElement): void {
  for (const group of scope.querySelectorAll<HTMLElement>("[data-draw-group]")) {
    gsap.fromTo(
      group.querySelectorAll("[data-draw]"),
      { "--draw": 0 },
      {
        "--draw": 1,
        duration: 1.1,
        stagger: 0.25,
        ease: "power2.inOut",
        scrollTrigger: { trigger: group, start: "top 75%", once: true },
      },
    );
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
      // Grupos separados: pasar de ancho a angosto no repite la entrada.
      mm.add(motion, () => {
        intro(root);
        reveals(root);
        draws(root);
        counts(root);
      });
      mm.add(`${motion} and (min-width: 768px)`, () => {
        heroScroll(root);
        productFrame(root);
      });
      mm.add(`${motion} and (hover: hover) and (pointer: fine)`, () => hoverPops(root));
      // Las fuentes cambian la altura de las líneas: se recalculan los puntos de disparo.
      void document.fonts.ready.then(() => ScrollTrigger.refresh());
      return () => mm.revert();
    },
    { scope },
  );

  return (
    <div ref={scope} className="flex min-h-full flex-col overflow-x-clip">
      {children}
    </div>
  );
}
