import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Todo dato de Yunque es por empresa y por petición. Sin caché de componentes
  // para que ninguna pantalla muestre una decisión vieja.
  cacheComponents: false,
  // Archivos que el servidor lee del disco en tiempo de ejecución y que el rastreo del build
  // no ve, porque la ruta se arma con process.cwd(): la empresa de ejemplo (data/seed) y el
  // dataset de la demo (lote, historial con sus páginas, bandeja). Las plantillas no van.
  outputFileTracingIncludes: {
    "/**": [
      "./data/seed/*.json",
      "./data/dataset/*.json",
      "./data/dataset/generado/**/*",
      "./data/dataset/bandeja/**/*",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
