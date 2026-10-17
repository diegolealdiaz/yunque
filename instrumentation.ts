/**
 * Se ejecuta una vez al arrancar el servidor de Next.js.
 * Valida la configuración antes de atender la primera petición: si falta una
 * variable requerida, el proceso falla aquí con la lista de problemas y no arranca.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getConfig } = await import("./src/config");
  getConfig();
}
