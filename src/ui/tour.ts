/**
 * El recorrido guiado (docs/interfaz.md §5.9): cuatro pasos sobre pantallas reales, cada uno
 * señala algo que ya está a la vista. Empieza por "Probar el agente" porque una empresa recién
 * creada todavía no tiene nada en Pendientes.
 */

export type TourStep = {
  /** Pantalla del paso. */
  readonly route: string;
  /** Valor de `data-tour` del elemento que señala. */
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    route: "/probar",
    anchor: "galeria",
    title: "Empieza por aquí",
    body: "Elige una factura y mira qué decide el agente: la lee, revisa tus reglas y decide en segundos. Cada una trae algo distinto.",
  },
  {
    route: "/pendientes",
    anchor: "pendientes",
    title: "Lo que espera tu decisión",
    body: "El agente paga solo lo que cumple tus reglas. Lo que no, llega aquí con el porqué en palabras simples, y tú apruebas, corriges o rechazas.",
  },
  {
    route: "/reglas",
    anchor: "limites",
    title: "Tú pones los límites",
    body: "Hasta cuánto paga solo, a quién y qué hacer cuando algo no cuadra. Cada cambio queda firmado por una persona y muestra antes qué cambiaría.",
  },
  {
    route: "/bitacora",
    anchor: "bitacora",
    title: "Todo queda escrito",
    body: "Cada decisión del agente y de tu equipo, en orden y con su porqué. Nadie puede editarla ni borrarla.",
  },
];

/** Llave en el navegador: el recorrido se muestra solo la primera vez. */
export const TOUR_SEEN_KEY = "yunque-recorrido";
/** Evento para volver a abrirlo desde la barra lateral. */
export const TOUR_OPEN_EVENT = "yunque:recorrido";
