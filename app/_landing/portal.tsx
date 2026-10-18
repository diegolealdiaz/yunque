import { AgentLive } from "./agent-live";

/**
 * El portal, debajo del titular: un marco de anillos con el degradado de marca y, al fondo, el
 * agente decidiendo. En escritorio la sección es más alta que la pantalla y queda fija: al
 * bajar, los anillos se abren hacia afuera y la escena crece hasta llenar el marco, como entrar
 * por una puerta (app/_landing/motion.tsx). Sin animación, en el teléfono o con "reducir
 * movimiento", se ve la escena completa y los anillos no aparecen.
 */

/** Cuánto de la marca lleva cada anillo, de afuera hacia adentro; el resto es el papel. */
const RINGS = [
  { start: 95, end: 70 },
  { start: 80, end: 60 },
  { start: 64, end: 50 },
  { start: 50, end: 40 },
  { start: 36, end: 30 },
  { start: 24, end: 20 },
  { start: 13, end: 11 },
] as const;

export function Portal() {
  return (
    <section
      data-portal
      aria-label="El agente en acción"
      className="relative left-1/2 -ml-[50vw] w-screen md:h-[230vh]"
    >
      <div className="px-4 sm:px-6 md:sticky md:top-16 md:flex md:h-[calc(100vh-4rem)] md:items-center md:px-0">
        <div
          data-portal-frame
          data-intro="frame"
          className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-[32px] md:h-full md:max-w-none md:rounded-none"
        >
          {RINGS.map((ring, i) => (
            <span
              key={ring.start}
              aria-hidden="true"
              data-portal-ring
              className="invisible absolute inset-0 rounded-[48px]"
              style={{
                zIndex: i,
                backgroundImage: `linear-gradient(180deg, color-mix(in oklab, var(--brand) ${String(ring.start)}%, var(--paper)), color-mix(in oklab, var(--brand-grad-end) ${String(ring.end)}%, var(--paper)))`,
              }}
            />
          ))}
          <div
            data-portal-scene
            className="relative z-10 flex h-full items-center justify-center overflow-hidden rounded-[32px] bg-surface-sunken px-4 py-12 sm:px-8 md:rounded-[40px]"
          >
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <div className="hero-grid absolute inset-0" />
              <div className="aurora aurora-scene" />
            </div>
            <div className="relative w-full max-w-[560px]">
              <AgentLive />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
