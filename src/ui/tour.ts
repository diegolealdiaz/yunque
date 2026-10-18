/**
 * El recorrido guiado (docs/interfaz.md §5.9): nueve pasos sobre pantallas reales que explican
 * la plataforma a quien entra por primera vez, sin que nadie esté al lado. Empieza con una
 * bienvenida que da el vocabulario (los tres veredictos), sigue el camino de una factura
 * (probar, Pendientes, el porqué y la decisión), muestra el control (Reglas, Métricas y
 * Bitácora) y termina con una acción concreta. Ningún paso cambia datos.
 */

/** Ruta que se resuelve al llegar al paso: el detalle de una factura de la empresa. */
export const TOUR_INVOICE_ROUTE = "/facturas/:factura";

export type TourStep = {
  /** Pantalla del paso; `TOUR_INVOICE_ROUTE` es el detalle de una factura de ejemplo. */
  readonly route: string;
  /** Valor de `data-tour` del elemento que señala; null, una tarjeta centrada sin marco. */
  readonly anchor: string | null;
  readonly title: string;
  readonly body: string;
  /** Contenido extra de la tarjeta: la leyenda de veredictos o las acciones del final. */
  readonly extra?: "veredictos" | "acciones";
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    route: "/probar",
    anchor: null,
    title: "Bienvenido a Yunque",
    body: "Yunque es un agente de cuentas por pagar: lee cada factura, la revisa contra las reglas de tu empresa y decide. Trabajas con Forja Labs, una empresa de ejemplo; ningún pago mueve dinero real. Cada factura termina en uno de tres veredictos:",
    extra: "veredictos",
  },
  {
    route: "/probar",
    anchor: "galeria",
    title: "Prueba al agente en vivo",
    body: "Cada factura de ejemplo trae una situación distinta: un proveedor de siempre, una cuenta bancaria cambiada, un correo que intenta saltarse la revisión. Elige una y mira qué decide en segundos.",
  },
  {
    route: "/probar",
    anchor: "subir",
    title: "O prueba con tu propia factura",
    body: "Súbela en PDF o foto, o envíala por correo o Telegram desde Facturas → «Probar con tu factura». Si su proveedor no está registrado, el agente no la paga: te la pasa para que decidas.",
  },
  {
    route: "/pendientes",
    anchor: "pendientes",
    title: "Pendientes: solo lo que necesita a una persona",
    body: "El agente paga por su cuenta lo que cumple tus reglas. Lo demás llega aquí, ordenado por vencimiento y con el motivo a la vista.",
  },
  {
    route: TOUR_INVOICE_ROUTE,
    anchor: "por-que",
    title: "El porqué de cada decisión",
    body: "Cada factura explica en palabras simples qué decidió el agente y qué regla lo llevó a eso. Más abajo, el documento con cada dato señalado en el lugar donde se leyó.",
  },
  {
    route: TOUR_INVOICE_ROUTE,
    anchor: "decision",
    title: "Tu decisión",
    body: "Aquí resuelves las facturas que esperan a una persona: eliges quién firma en «Resuelves como», marcas lo que verificaste y apruebas, corriges un dato o rechazas. Si el proveedor es nuevo, lo registras aquí mismo; con la doble firma, otra persona confirma.",
  },
  {
    route: "/reglas",
    anchor: "limites",
    title: "Tus reglas mandan",
    body: "Defines hasta cuánto paga solo, el presupuesto, a quién se le puede pagar y qué hacer cuando algo no cuadra; antes de guardar ves qué facturas cambiarían. Arriba están los interruptores: pagos, modo de prueba, autonomía y doble firma.",
  },
  {
    route: "/metricas",
    anchor: "metricas",
    title: "Cuánto decide solo, y sin errores",
    body: "Qué parte de las facturas resuelve el agente sin una persona, cuántas pagó sin deber (cero), cuánto cuesta y cuánto tarda cada decisión.",
  },
  {
    route: "/bitacora",
    anchor: "bitacora",
    title: "Todo queda escrito",
    body: "Cada paso del agente y de tu equipo, en orden, con quién lo hizo y por qué. Nadie puede editarlo ni borrarlo. Ya conoces Yunque: ¿por dónde empiezas?",
    extra: "acciones",
  },
];

/** Llave en el navegador: el recorrido se muestra solo la primera vez. */
export const TOUR_SEEN_KEY = "yunque-recorrido";
/** Evento para volver a abrirlo desde la barra lateral. */
export const TOUR_OPEN_EVENT = "yunque:recorrido";
