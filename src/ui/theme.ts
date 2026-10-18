/**
 * Tema de la interfaz (docs/interfaz.md §6): claro u oscuro, con los mismos tokens. La
 * elección de la persona se guarda en su navegador; si no eligió, manda la del sistema.
 * El tema se fija en `<html data-theme>` antes de pintar, para que la página no parpadee.
 */

export type Theme = "light" | "dark";

/** Llave en localStorage. Es una preferencia del navegador, no un dato de la empresa. */
export const THEME_STORAGE_KEY = "yunque-tema";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** El tema que sigue al pulsar el selector. */
export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/**
 * Si la animación de entrada no arranca (sin JavaScript, un error), el velo se levanta solo
 * a los pocos segundos: el contenido nunca queda oculto.
 */
export const MOTION_FAILSAFE_MS = 4000;

/**
 * Script que corre en <head> antes de pintar: lee la elección guardada o la del sistema y
 * la pone en `data-theme`. Si el almacenamiento está bloqueado, queda el tema claro.
 * También arma el velo de la entrada animada (`data-motion="on"`), salvo con "reducir
 * movimiento": lo que la portada anima al entrar no se ve antes de que la animación lo muestre.
 */
export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}d.dataset.theme=t}catch(e){d.dataset.theme="light"}try{if(!matchMedia("(prefers-reduced-motion: reduce)").matches){d.dataset.motion="on";setTimeout(function(){d.dataset.motion="done"},${String(
  MOTION_FAILSAFE_MS,
)})}}catch(e){}})()`;
