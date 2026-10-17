# Yunque

<p align="center"><img src="docs/marca/yunque-logo.png" alt="Yunque: el agente que paga sin salirse de las reglas" width="320"></p>

El agente que paga sin salirse de las reglas.

Yunque revisa las cuentas por pagar de una empresa y decide cuáles pagar, cuáles frenar y cuáles escalar a una persona, dentro de las reglas que la empresa define. Cada decisión queda registrada y explicada.

Proyecto del equipo **Forja** para el reto Blinka.

## Cómo funciona

Cada factura entra por un canal (subida, correo o lote de ejemplo) y recorre el mismo camino: se normaliza, un modelo de lenguaje **solo lee** los datos, un motor determinista **decide** con las reglas de la empresa, y la decisión queda registrada con su explicación. El modelo nunca decide: si algo no cuadra, el veredicto solo puede endurecerse. Lo que se sale de las reglas espera a una persona en Pendientes.

El detalle está en [Arquitectura](docs/arquitectura.md); la estructura de carpetas, en su [sección 8](docs/arquitectura.md#8-estructura-del-proyecto).

## Arranque rápido

Requisitos: Node 22 (ver `.nvmrc`).

1. `npm ci`
2. `cp .env.example .env.local` y completa `APPROVAL_SIGNING_SECRET` y `SESSION_SECRET` con `openssl rand -hex 32` (deben ser distintos). Sin `OPENROUTER_API_KEY` la app arranca, pero el Lector queda apagado y toda factura escala como ilegible.
3. `npm run db:migrate` crea `data/yunque.db`. `npm run dev` no corre las migraciones.
4. `npm run dev` y abre http://localhost:3000. En modo demo (`DEMO_MODE=true`, el valor por defecto) cada visitante recibe su propia empresa de ejemplo al primer acceso. Con `DEMO_MODE=false`, siembra la empresa base con `npm run seed`.

Si el navegador recarga en bucle con `npm run dev`, usa `npm run build && npm run start`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas unitarias, de propiedad, de base y del pipeline completo, sin red |
| `npm run eval` | Set de regresión contra la decisión esperada de cada caso. Sin clave: `EVAL_SOURCE=ideal npm run eval` |
| `npm run check` | Typecheck, lint, formato, pruebas y build. Se corre antes de cada commit |
| `npm run db:generate` | Genera una migración desde `src/db/schema.ts` |
| `npm run dataset` | Regenera el dataset de ejemplo desde el manifiesto y las plantillas |

## Despliegue

Pendiente (paso 29 del [plan](docs/plan.md)): Vercel para la app, Turso para la base y Vercel Blob para los archivos (hoy se guardan en `data/files`). Producción exige `OPENROUTER_API_KEY` y `DEMO_MODE=true`: todavía no hay inicio de sesión. Las migraciones se aplican a Turso con `DATABASE_URL` y `DATABASE_AUTH_TOKEN` puestos y `npm run db:migrate`. Ponle a la clave de OpenRouter un límite de gasto.

## Correo real en la demo (opcional)

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
