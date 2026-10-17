import nextEnv from "@next/env";

/**
 * Carga `.env.local` y `.env` con la misma precedencia que Next.js, para que los scripts
 * de consola vean las mismas variables que la app. Se importa primero en cada script.
 * El paquete es CommonJS: se usa la importación por defecto.
 */
nextEnv.loadEnvConfig(process.cwd(), process.env["NODE_ENV"] !== "production", {
  info: () => undefined,
  error: (...args: unknown[]) => {
    console.error(...args);
  },
});
