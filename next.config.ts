import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Todo dato de Yunque es por empresa y por petición. Sin caché de componentes
  // para que ninguna pantalla muestre una decisión vieja.
  cacheComponents: false,
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
