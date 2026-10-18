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
4. `npm run dev` y abre http://localhost:3000: la portada presenta el producto y "Probar la demo" entra a él. En modo demo (`DEMO_MODE=true`, el valor por defecto) cada visitante recibe su propia empresa de ejemplo al entrar al producto. Con `DEMO_MODE=false`, siembra la empresa base con `npm run seed`.

Si el navegador recarga en bucle con `npm run dev`, usa `npm run build && npm run start`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas unitarias, de propiedad, de base y del pipeline completo, sin red |
| `npm run eval` | Set de regresión sobre las lecturas grabadas del modelo real, sin red ni clave. `EVAL_SOURCE=ideal npm run eval` lo corre con un Lector perfecto |
| `npm run check` | Typecheck, lint, formato, pruebas y build. Se corre antes de cada commit |
| `npm run db:generate` | Genera una migración desde `src/db/schema.ts` |
| `npm run dataset` | Regenera el dataset de ejemplo desde el manifiesto y las plantillas |

## Despliegue

Pendiente (paso 29 del [plan](docs/plan.md)): Vercel para la app, Turso para la base y Vercel Blob para los archivos (hoy se guardan en `data/files`). Producción exige `OPENROUTER_API_KEY` y `DEMO_MODE=true`: todavía no hay inicio de sesión. Las migraciones se aplican a Turso con `DATABASE_URL` y `DATABASE_AUTH_TOKEN` puestos y `npm run db:migrate`. Ponle a la clave de OpenRouter un límite de gasto.

## Correo y Telegram para clientes (opcional)

Los clientes pueden probar el agente con una factura propia: por correo, o enviándola a un bot de Telegram que además les avisa cuando una factura necesita su decisión. En Facturas, "Probar con tu factura" pide un código de acceso y abre los dos canales por 72 horas. Las protecciones y el porqué están en las decisiones D23 y D24 de [Decisiones](docs/decisiones.md).

**Código de acceso.** Elige uno de al menos 12 caracteres, guárdalo en `DEMO_ACCESS_CODE` y entrégaselo a los clientes por fuera del repo.

**Correo** (Postmark):

1. Crea una cuenta en Postmark y un servidor. En su pestaña de entrada copia la dirección (`...@inbound.postmarkapp.com`) en `INBOUND_EMAIL_ADDRESS`.
2. Genera el secreto del webhook con `openssl rand -hex 32` y guárdalo en `INBOUND_EMAIL_WEBHOOK_SECRET`.
3. En Postmark, configura el webhook de entrada con `https://yunque:<secreto>@<tu-dominio>/api/correo/entrante`.
4. Pon `INBOUND_EMAIL_ENABLED=true`.

**Telegram:**

1. Crea el bot con @BotFather. Guarda su token en `TELEGRAM_BOT_TOKEN` y su nombre, sin @, en `TELEGRAM_BOT_USERNAME`.
2. Genera el secreto del webhook con `openssl rand -hex 32` y guárdalo en `TELEGRAM_WEBHOOK_SECRET`.
3. Pon la URL pública de la app en `PUBLIC_APP_URL`, para el botón "Abrir en Yunque" de los avisos.
4. Registra el webhook, con el secreto, después de desplegar:
   ```
   curl "https://api.telegram.org/bot<token>/setWebhook" \
     -d url=https://<tu-dominio>/api/telegram -d secret_token=<secreto>
   ```

**Techo de gasto.** En OpenRouter, ponle a la clave un límite (por ejemplo, 10 USD). Es la última capa: protege también la subida y los botones de ejemplo.

Para apagarlos: `INBOUND_EMAIL_ENABLED=false` apaga el correo; quitar las tres variables de Telegram apaga el bot. Las rutas responden 404 y la pantalla deja de ofrecerlos.

## API de decisión para tu agente

Tu propio agente le pregunta a Yunque antes de pagar y recibe `pagar`, `frenar` o `escalar`, con la regla que decidió, el porqué y el enlace al acta. Pasa por el mismo motor, las mismas reglas y el mismo registro que cualquier factura (decisión D32 de [Decisiones](docs/decisiones.md)).

**Llave.** Con el acceso de cliente vigente, en Facturas → "Probar con tu factura" → "Conectar tu agente", genera la llave `yq_…`. Se muestra una sola vez, vence con el acceso y generar otra anula la anterior.

**Con campos** (sin modelo: Yunque arma el PDF de la solicitud y lo verifica como una factura):

```bash
curl https://<tu-dominio>/api/decide \
  -H "Authorization: Bearer yq_..." \
  -H "Content-Type: application/json" \
  -d '{"idempotency_key":"pago-001","payee_name":"Nube Andina SAS","invoice_number":"NA-2026-10",
       "currency":"COP","total":"4800000.00","bank_account":"31245679023","due_date":"2026-11-20"}'
```

Obligatorios: `idempotency_key`, `payee_name`, `invoice_number`, `currency` y `total` (decimal con punto, como texto). Opcionales: `payee_tax_id`, `issue_date`, `due_date`, `subtotal`, `taxes`, `bank_account`, `bank_holder`, `purchase_order`, `hours` y `description`.

**Con documento** (PDF o imagen, lo lee el modelo): `multipart/form-data` con `file` e `idempotency_key`.

**Respuesta.** `201` con la decisión nueva, o `200` si la llave ya se había usado con la misma solicitud. Reusar la llave con otros datos responde `400`.

```json
{
  "reference": "YQ-2026-10-0003",
  "status": "decidida",
  "verdict": "frenar",
  "deciding_rule": "bank_account_mismatch",
  "headline": "No se pagó.",
  "findings": [{ "code": "bank_account_mismatch", "action": "frenar", "title": "La cuenta bancaria cambió", "detail": "..." }],
  "payment_order": null,
  "record_url": "https://<tu-dominio>/facturas/..."
}
```

**Estado.** `GET /api/decide/{reference}` devuelve el estado vigente: así el agente sabe cuándo una persona aprobó o rechazó lo que escaló. Si tienes Telegram conectado, la escalada también te avisa ahí.

### Con Claude u otro asistente (MCP)

`mcp/server.ts` expone la API como servidor MCP, con tres herramientas: `decide_payment` (con campos), `decide_invoice_file` (un PDF o foto del disco) y `get_decision` (estado por referencia). Es un cliente delgado: decidir sigue siendo del motor de Yunque. La `idempotency_key` es obligatoria y única por pago: la misma factura con otra llave se frena como duplicada, y una repetición con la misma llave se avisa como tal.

En Claude Code:

```bash
claude mcp add yunque -e YUNQUE_API_KEY=yq_... -e YUNQUE_URL=https://<tu-dominio> \
  -- npx tsx <ruta-al-repo>/mcp/server.ts
```

En Claude Desktop, en `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "yunque": {
      "command": "npx",
      "args": ["tsx", "<ruta-al-repo>/mcp/server.ts"],
      "env": { "YUNQUE_API_KEY": "yq_...", "YUNQUE_URL": "https://<tu-dominio>" }
    }
  }
}
```

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
