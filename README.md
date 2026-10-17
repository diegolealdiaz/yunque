# Yunque

<p align="center"><img src="docs/marca/yunque-logo.png" alt="Yunque: el agente que paga sin salirse de las reglas" width="320"></p>

El agente que paga sin salirse de las reglas.

Yunque revisa las cuentas por pagar de una empresa y decide cuáles pagar, cuáles frenar y cuáles escalar a una persona, dentro de las reglas que la empresa define. Cada decisión queda registrada y explicada.

Proyecto del equipo **Forja** para el reto Blinka.

## Correo real en la demo

Los jurados pueden enviar una factura propia por correo y ver cómo la decide el agente. En Facturas, "Recibir por correo" pide un código de acceso y entrega una dirección personal que vence sola. Las protecciones y el porqué están en la decisión D23 de [Decisiones](docs/decisiones.md).

Para encenderlo en un despliegue:

1. Crea una cuenta en Postmark y un servidor. En su pestaña de entrada copia la dirección (`...@inbound.postmarkapp.com`) en `INBOUND_EMAIL_ADDRESS`.
2. Genera el secreto del webhook con `openssl rand -hex 32` y guárdalo en `INBOUND_EMAIL_WEBHOOK_SECRET`.
3. En Postmark, configura el webhook de entrada con `https://yunque:<secreto>@<tu-dominio>/api/correo/entrante`.
4. Elige un código de acceso de al menos 12 caracteres, guárdalo en `INBOUND_EMAIL_ACCESS_CODE` y entrégaselo a los jurados por fuera del repo.
5. Pon `INBOUND_EMAIL_ENABLED=true`.
6. En OpenRouter, ponle a la clave un límite de gasto (por ejemplo, 10 USD). Es el techo final: protege también la subida y los botones de ejemplo.

Para apagarlo, `INBOUND_EMAIL_ENABLED=false`: las rutas responden 404 y el botón desaparece.

## Documentación

| Documento | Qué contiene |
|---|---|
| [Arquitectura](docs/arquitectura.md) | Dominio, catálogo de reglas, pipeline de decisión, roles, canales, pantallas, infraestructura |
| [Decisiones](docs/decisiones.md) | Registro de decisiones de arquitectura y alternativas descartadas |
| [Trazabilidad](docs/trazabilidad.md) | Cada exigencia del reto y el componente que la cubre |
| [Interfaz](docs/interfaz.md) | Principios, navegación, pantallas y sistema visual |
| [Roadmap](docs/roadmap.md) | Qué entra en la demo, qué sigue y qué se descartó |
| [Prácticas](docs/practicas.md) | Reglas de ingeniería del equipo |
| [Blinka](docs/blinka.md) | Encaje con el producto de Blinka |
| [Reto](docs/reto.md) | Texto del reto |
| [Plan](docs/plan.md) | Pasos de construcción con criterio de terminado, guion del pitch y lista previa |
| [Pruebas](docs/pruebas.md) | Catálogo de pruebas, fronteras por regla, validaciones y trampas conocidas |
