# Despliegue

Yunque corre en Vercel con la base en Turso, los archivos en un almacén privado de Vercel Blob y el modelo en OpenRouter (D27). Este documento es la lista de pasos para dejarlo en línea desde cero.

## 1. Cuentas y servicios

1. **Turso.** Crear una base (`yunque`) y, para ella, un token de acceso. Se anotan la URL (`libsql://…`) y el token.
2. **Vercel.** Importar el repositorio. Framework: Next.js; el comando de build lo fija `vercel.json` (aplica las migraciones y compila). Node 22.
3. **Vercel Blob.** En el proyecto: Storage → Create → Blob, con acceso **privado**, y conectarlo al proyecto. Vercel agrega `BLOB_READ_WRITE_TOKEN` solo.
4. **OpenRouter.** Una clave solo para producción, con límite de crédito. Es el techo de gasto si alguien abusa de la demo.

## 2. Variables de entorno en Vercel

Todas en Production y Preview. Los secretos se generan con `openssl rand -hex 32`, uno distinto por variable, y nunca se copian al repositorio.

| Variable | Valor |
|---|---|
| `OPENROUTER_API_KEY` | La clave de producción |
| `DATABASE_URL` | La URL de Turso |
| `DATABASE_AUTH_TOKEN` | El token de Turso |
| `BLOB_READ_WRITE_TOKEN` | La pone Vercel al conectar el almacén |
| `APPROVAL_SIGNING_SECRET` | Secreto generado |
| `SESSION_SECRET` | Secreto generado, distinto del anterior |
| `CRON_SECRET` | Secreto generado, distinto de los anteriores |
| `SYSTEM_HARD_CAP_USD_CENTS` | `10000000` (tope absoluto por pago: 100.000 USD) |
| `DEMO_MODE` | `true` |
| `MAX_UPLOAD_BYTES` | `4000000`: Vercel no acepta peticiones de más de 4,5 MB |

Las demás tienen valor por defecto (`.env.example`). El correo real (D23) y Telegram (D24) son opcionales: sin sus variables quedan apagados o simulados.

## 3. Primer despliegue

1. Desplegar desde `master`. El build aplica las migraciones sobre Turso; si falta una variable requerida, falla con la lista de las que faltan.
2. Abrir la URL y recorrer: portada → «Probar la demo» → Probar el agente → procesar un caso de la galería y subir una factura propia → Pendientes, detalle con el documento, Reglas, Métricas y Bitácora.
3. `GET /api/health` debe responder 200.
4. Poner la URL en `PUBLIC_APP_URL` si se activa Telegram, y volver a desplegar.

## 4. Lo que queda corriendo

- Cada push a `master` despliega a producción; cada rama, a una vista previa sobre la misma base.
- El cron de `vercel.json` entrega cada día los avisos atrasados (`/api/avisos`).
- Topes de la demo: facturas por visitante y por día, empresas de ejemplo nuevas por día, y el límite de crédito de la clave del modelo.
