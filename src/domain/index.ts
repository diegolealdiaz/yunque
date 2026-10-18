/**
 * Dominio de Yunque. Puro: sin Next, sin base de datos, sin red. Usa `node:crypto` para
 * hashes y azar, así que corre en el runtime de Node, no en Edge.
 *
 * Todo tipo deriva de un esquema zod estricto.
 *
 * Idioma de los valores: lo que una persona lee en pantalla o en la bitácora va en español
 * (estados, veredictos, acciones, actores, fuentes). Lo que es código o convención técnica
 * va en inglés (códigos de regla y de evento, severidad, periodos, canales, rutas de pago).
 */

export * from "./approval";
export * from "./company";
export * from "./currency";
export * from "./decision";
export * from "./event";
export * from "./extraction";
export * from "./finding";
export * from "./fx";
export * from "./hash";
export * from "./ids";
export * from "./inbound";
export * from "./invoice";
export * from "./llm-call";
export * from "./money";
export * from "./notification";
export * from "./payment-request";
export * from "./policy";
export * from "./rules";
export * from "./telegram";
export * from "./vendor";
