import type { MetadataRoute } from "next";

/**
 * Los buscadores ven la portada y nada más. Cada pantalla del producto, abierta sin cookie,
 * siembra una empresa de ejemplo nueva y gasta uno de los cupos diarios de la demo.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/probar",
        "/pendientes",
        "/facturas",
        "/reglas",
        "/metricas",
        "/bitacora",
        "/salud",
        "/componentes",
        "/api/",
      ],
    },
  };
}
