# Plan de construcción

> Documento operativo: pasos en orden de dependencia, cada uno con lo que construye, cuándo está terminado y qué prueba lo respalda. El diseño vive en `arquitectura.md`; las pruebas, en `pruebas.md`.

## Cómo leer este plan

- Los pasos están en el orden en que se construyen. Ninguno empieza hasta que el anterior cumple su "hecho cuando".
- Cada paso referencia las pruebas de `pruebas.md` que debe dejar en verde. Un paso sin sus pruebas en verde no está terminado.
- Todo lo marcado **[núcleo]** es obligatorio para la entrega. Lo marcado **[recorte]** se elimina si falta tiempo, en el orden de la sección 11.
- Un commit por paso como mínimo. El mensaje nombra el paso. `npm run check` se corre cuando el usuario lo pide, no en cada paso: por tiempo, las pruebas se lanzan solo cuando la acción lo requiere.

## Fase 0. Preparación

### Paso 0. Cuentas y claves
- **Construye:** clave de OpenRouter con tope de gasto mensual; proyecto en Vercel conectado al repo; base en Turso; token de Vercel Blob. Identificadores exactos de Haiku 5.5 y Sonnet 5.5 confirmados en OpenRouter.
- **Hecho cuando:** `.env.local` completo, ninguna clave en el repo, y una petición manual al modelo responde.

## Fase 1. Cimientos

### Paso 1. Scaffold [núcleo]
- **Construye:** Next.js con App Router y TypeScript estricto, Node 22 fijado en `engines` y en `.nvmrc`, ESLint y Prettier, Vitest, estructura de carpetas de `arquitectura.md` §8, scripts `dev`, `check` (typecheck, lint, test, build), `dataset`, `eval`, `seed`.
- **Hecho cuando:** `npm run check` pasa en limpio sobre el proyecto vacío.
- **Prueba:** P-01.

### Paso 2. Configuración validada [núcleo]
- **Construye:** `src/config.ts` lee las variables de `.env.example` con zod. Falta una requerida: la app no arranca con un mensaje que nombra la variable. Modelos, topes y tope absoluto del sistema salen de aquí.
- **Hecho cuando:** arrancar sin `OPENROUTER_API_KEY` falla con mensaje claro; arrancar con todo arranca.
- **Prueba:** P-02.

### Paso 3. Integración continua [núcleo]
- **Construye:** `.github/workflows/ci.yml` con instalación, `npm run check` y, más adelante, el set de regresión. Vercel despliega solo si CI está verde.
- **Hecho cuando:** un push rojo no se despliega y uno verde sí.
- **Prueba:** P-03.

### Paso 4. Dominio [núcleo]
- **Construye:** `src/domain`: dinero en enteros con moneda, monedas y rieles soportados, tasas FX fijas, política (esquema zod con claves protegidas y nivel de autonomía), factura, extracción con evidencia por campo, hallazgo, decisión, aprobación, evento. Formateo de montos por moneda. Identificadores ULID y referencia legible.
- **Hecho cuando:** todo tipo del sistema deriva de un esquema zod y los esquemas son estrictos (rechazan claves desconocidas).
- **Prueba:** P-10 a P-14.

### Paso 5. Base de datos [núcleo]
- **Construye:** esquema drizzle con columna de organización en todas las tablas; tablas append-only para política, decisiones, aprobaciones y eventos; `invoices`, `vendors`, `ledger`, `jobs`, `notifications`, `llm_calls`; migraciones; repositorios por agregado; función de transacción. Semilla: empresa, saldos, vendors, política v1.
- **Hecho cuando:** migraciones corren en archivo local y en Turso; la semilla deja una empresa lista; ningún módulo fuera de `src/db` importa el driver.
- **Prueba:** P-40 a P-42.

## Fase 2. Motor de decisión

### Paso 6. Catálogo de reglas [núcleo]
- **Construye:** `src/engine/rules`: las 21 reglas como funciones puras `(contexto) → hallazgo | null`, cada una con identificador, parámetros tipados, `on_fail` y severidad. Registro central que garantiza que toda regla de la política existe en el código y viceversa.
- **Hecho cuando:** cada regla tiene su tabla de casos frontera en verde y el registro rechaza una política que nombre una regla inexistente.
- **Prueba:** P-20 (matriz completa), P-21.

### Paso 7. Evaluación y veredicto [núcleo]
- **Construye:** `evaluate(extraction, payeeMatch, policy, ledger, balances, clock)` devuelve hallazgos y veredicto. Orden de severidad: cualquier `frenar` gana; si no, cualquier `escalar`; si no, `pagar`. Kill switch y nivel de autonomía aplicados aquí. Fecha programada calculada aquí. Sin reloj implícito: la fecha entra como parámetro.
- **Hecho cuando:** las once invariantes de seguridad tienen test de propiedad en verde con miles de casos generados.
- **Prueba:** P-22 a P-33.

### Paso 8. Libro mayor y transiciones [núcleo]
- **Construye:** reserva de presupuesto con `UPDATE ... WHERE comprometido + monto <= límite` en la misma transacción de la decisión; conversión a USD con tasa fija y redondeo documentado; transiciones de estado por comparación y cambio; idempotencia por hash de archivo y por llave semántica.
- **Hecho cuando:** dos procesos concurrentes no pueden superar el límite ni aprobar la misma decisión dos veces.
- **Prueba:** P-43 a P-47.

### Paso 9. Explicador [núcleo]
- **Construye:** `src/explain`: plantilla en español por regla, con valor observado, umbral y cita; resumen de la decisión; texto del checklist de aprobación derivado de los hallazgos. Sin modelo.
- **Hecho cuando:** toda regla tiene plantilla y ninguna explicación interpola contenido del documento sin escapar.
- **Prueba:** P-34, P-35.

## Fase 3. Documentos y modelo

### Paso 10. Generador del dataset [núcleo]
- **Construye:** `scripts/generate-dataset.ts`: cuatro plantillas de factura en JSON con posiciones por campo; manifiesto con 25 facturas, cada una con decisión esperada, regla esperada y motivo; set adversarial; dos meses de historial; saldos calibrados. Genera PDF, PNG (versión escaneada), correos y mensajes. Guarda verdad esperada y coordenadas por campo.
- **Hecho cuando:** `npm run dataset` regenera todo de forma determinista (mismo manifiesto, mismos bytes) y el manifiesto valida con zod.
- **Prueba:** P-50, P-51.

### Paso 11. Ingesta y normalización [núcleo]
- **Construye:** `src/extraction/ingest`: hash SHA-256 del archivo, verificación de tipo por contenido, límite de tamaño y páginas, guardado en almacenamiento, texto por página si hay capa, PNG por página con PDFium en WebAssembly. Correo y chat (JSON con adjunto) a texto con metadatos. Estado `recibida` lo pone el caso de uso del paso 16.
- **Hecho cuando:** un PDF con texto produce texto y PNG; un PDF escaneado produce PNG y texto vacío; un archivo disfrazado se rechaza; el mismo archivo dos veces produce una sola factura.
- **Prueba:** P-52 a P-56.

### Paso 12. Lector [núcleo]
- **Construye:** `src/extraction/reader`: única importación del SDK del modelo. Prompt con versión, contenido delimitado y etiquetado como no confiable, salida estructurada validada con zod en nuestro código, un reintento, temperatura cero, `maxOutputTokens` acotado. Caché exacta por hash de documento más versión de prompt, esquema y modelo. Registro en `llm_calls` con tokens, costo y latencia. El modelo no recibe vendors ni saldos.
- **Hecho cuando:** sobre el dataset, cada campo esperado se extrae con la cita correcta en al menos el 99 por ciento; la segunda pasada sobre el mismo documento no llama al modelo.
- **Prueba:** P-60 a P-65.

### Paso 13. Verificador y respaldo [núcleo]
- **Construye:** cada cita existe literalmente en el texto; el valor normalizado se deriva de la cita; totales cuadran; campo con dos candidatos marcado. Si falla, una sola pasada con el modelo de respaldo; si vuelve a fallar, hallazgo `evidence_missing` o `field_ambiguous` y se sigue.
- **Hecho cuando:** una cita inventada se detecta; un total que no cuadra se detecta; el respaldo se invoca una vez y nunca en bucle.
- **Prueba:** P-66 a P-69.

### Paso 14. Resolutor de beneficiario [núcleo]
- **Construye:** `src/resolve`: coincidencia del beneficiario contra la lista de vendors por identificador fiscal, nombre normalizado y alias; comparación de cuenta y titular con la registrada; resultado emparejado (por identificador fiscal, nombre exacto o alias) o desconocido con el vendor más parecido y su similitud. La cuenta destino de la orden sale siempre del vendor, nunca del texto.
- **Hecho cuando:** "Nube Andina S.A.S." y "NUBE ANDINA SAS" resuelven al mismo vendor; "Nube Andina Ltda" resuelve desconocido con Nube Andina SAS como el más parecido; una cuenta distinta produce la señal de cambio.
- **Prueba:** P-70 a P-73.

### Paso 15. Detector de instrucciones y canario [núcleo]
- **Construye:** detector por patrones sobre el texto del documento y del correo (instrucciones al sistema, "ya aprobado", "ignora las reglas", texto oculto); token canario en el prompt que, si aparece en la salida, marca `suspicious_instructions`.
- **Hecho cuando:** los casos adversariales del dataset quedan en `frenar` por esta regla y ninguna factura normal la dispara.
- **Prueba:** P-74, P-75.

## Fase 4. Caso de uso completo

### Paso 16. processInvoice [núcleo]
- **Construye:** `src/usecases/processInvoice`: ingesta, extracción, verificación, resolución, evaluación, explicación, registro en una transacción (decisión, hallazgos, reserva, evento), encolado de notificación. Orden de pago preparada si `pagar`. Errores tipados; cualquier fallo intermedio deja la factura en `escalar` con el hallazgo del error.
- **Hecho cuando:** con extractor simulado, todas las facturas del manifiesto terminan en la decisión esperada y cada decisión tiene versión de política y hash.
- **Prueba:** P-80 a P-86.

### Paso 17. Evaluación por consola [núcleo]
- **Construye:** `npm run eval`: procesa el dataset completo y el adversarial contra la verdad esperada; imprime autonomía, falsos "pagar", exactitud por campo, costo total y por factura, latencia. Con `EVAL_LIVE=1` llama al modelo; sin él usa las salidas grabadas en `tests/fixtures`.
- **Hecho cuando:** cero falsos "pagar", exactitud por campo al 99 por ciento, y la salida del comando es el informe de la sección de métricas de `trazabilidad.md`.
- **Prueba:** P-90 a P-93.

### Paso 18. Calibración [núcleo]
- **Cuándo:** se hace al final, junto con el paso 0, cuando esté la clave del modelo. Hasta entonces CI corre el set con el Lector ideal y la Fase 5 avanza sin depender de él.
- **Construye:** ajuste de umbrales de confianza y tolerancias sobre el dataset hasta el punto de cero falsos "pagar" con el mínimo de escalados. Grabación de las salidas del modelo como fixtures para CI.
- **Hecho cuando:** la tasa de escalado sobre las facturas normales es la mínima que mantiene cero falsos "pagar", y CI corre `npm run eval` sin red.
- **Prueba:** P-92, P-93.

## Fase 5. Producto

### Paso 19. Base de interfaz [núcleo]
- **Construye:** tokens de `interfaz.md` §6, fuentes, barra lateral con cinco destinos y pie de controles, los nueve componentes base, navegación por teclado, estados vacío, carga y error. Sin pantallas todavía.
- **Hecho cuando:** una página de muestra renderiza los nueve componentes con datos falsos y pasa contraste y foco visible.
- **Prueba:** P-100.

### Paso 20. Pendientes [núcleo]
- **Construye:** inicio con tres secciones, orden por vencimiento, chip de veredicto con regla y detalle al pasar el ratón, contador en la barra lateral.
- **Hecho cuando:** con la semilla, muestra exactamente las escaladas, frenadas y pagadas del dataset.
- **Prueba:** P-101.

### Paso 21. Detalle de decisión [núcleo]
- **Construye:** tres columnas: imagen de página con citas resaltadas por coordenadas, texto con citas, campos con confianza y origen, reglas con valor y umbral, explicación con control de opinión, línea de tiempo, costo, orden preparada.
- **Hecho cuando:** seleccionar un campo resalta su cita en imagen y en texto; nada del documento se renderiza como HTML.
- **Prueba:** P-102, P-110.

### Paso 22. Aprobación, rechazo y corrección [núcleo]
- **Construye:** checklist derivado de hallazgos, botón inactivo hasta completar, firma sobre el contenido exacto verificada en servidor, primera resolución gana, rechazo con motivo, corrección manual de campo con origen "persona" y reevaluación, "reevaluar con política actual".
- **Hecho cuando:** una aprobación con hash o monto distinto se rechaza; dos aprobaciones simultáneas producen una sola; la corrección queda con quién y cuándo.
- **Prueba:** P-103, P-44, P-45.

### Paso 23. Facturas, subida y lote [núcleo]
- **Construye:** tabla con filtros, subida con validación en cliente y servidor, "Procesar periodo" orquestado por el cliente una factura por petición con progreso en vivo, "Leer bandeja" sobre la bandeja simulada.
- **Hecho cuando:** procesar el dataset desde la pantalla termina en menos de tres minutos y las filas cambian de estado en vivo.
- **Prueba:** P-104, P-105.

### Paso 24. Reglas y replay [núcleo]
- **Construye:** formulario y YAML sincronizados, claves protegidas visibles y bloqueadas, versiones con hash y firma, interruptores de pagos habilitados, modo de prueba y autonomía con confirmación, "Ver qué cambiaría" con diff antes de guardar.
- **Hecho cuando:** bajar el umbral y ver el diff muestra exactamente las decisiones que cambiarían; guardar crea v+1 y reevalúa las no finalizadas.
- **Prueba:** P-106, P-107, P-29.

### Paso 25. Métricas [núcleo]
- **Construye:** seis tarjetas y dos gráficos de `interfaz.md` §5.5, cada número enlazado a sus facturas.
- **Hecho cuando:** los números coinciden con los de `npm run eval` sobre la misma base.
- **Prueba:** P-108.

### Paso 26. Bitácora y salud [núcleo]
- **Construye:** lista de eventos con filtros; `/api/health` y su pantalla.
- **Hecho cuando:** cada transición del pipeline aparece como evento; `/api/health` responde rojo si falta la política o el modelo.
- **Prueba:** P-109, P-120.

### Paso 27. Orden de pago en PDF [recorte]
- **Construye:** plantilla de una página con beneficiario, cuenta, monto, riel, referencia, versión de política, hash y código QR; descarga desde el detalle.
- **Hecho cuando:** el PDF se genera en el servidor con los datos del vendor, nunca del texto extraído.
- **Prueba:** P-111.

### Paso 28. Notificaciones y bandeja simulada [núcleo]
- **Construye:** tabla de notificaciones como cola con reintentos e idempotencia; bandeja de correo simulada con mensajes del dataset; notificación en pantalla por decisión.
- **Hecho cuando:** una notificación fallida se reintenta y no se duplica; "Leer bandeja" procesa los correos y ninguno dos veces.
- **Prueba:** P-87, P-88.

## Fase 6. Despliegue

### Paso 29. Producción [núcleo]
- **Construye:** Vercel con Turso y Blob; empresa por visitante con cookie firmada; topes de subida, páginas y facturas por visitante y globales; `maxDuration` por ruta medido; archivos privados servidos solo a su empresa; reinicio de demo por empresa. Correo real para jurados (D23): cuenta de Postmark con su webhook de entrada apuntando a `/api/correo/entrante`, código de acceso entregado a los jurados por fuera del repo, y límite de gasto en la clave de OpenRouter.
- **Hecho cuando:** la URL pública procesa una factura de punta a punta; dos navegadores ven empresas distintas; superar un tope responde con mensaje claro; un correo con una factura adjunta a la dirección de un jurado aparece decidido en su lista.
- **Prueba:** P-121 a P-126, P-131 a P-134.

### Paso 30. Regresión en CI [núcleo]
- **Construye:** `npm run eval` con fixtures dentro de CI; falla si hay un falso "pagar" o si la exactitud baja del umbral.
- **Hecho cuando:** un cambio que relaja una regla pone CI en rojo.
- **Prueba:** P-93.

## Fase 7. Canales adicionales

### Paso 31. API de decisión [recorte]
- **Construye:** `POST /api/decide` con autenticación por token de empresa, mismo caso de uso, respuesta con veredicto, hallazgos y referencia.
- **Hecho cuando:** una petición con token inválido recibe 401; una válida con factura adjunta recibe la misma decisión que la pantalla.
- **Prueba:** P-127, P-128.

### Paso 32. Telegram [recorte]
- **Construye:** webhook con secreto, deduplicación por `update_id`, descarga del archivo, mismo caso de uso, respuesta con HTML escapado.
- **Hecho cuando:** una factura duplicada enviada por Telegram responde "frenada" con la regla; el mismo update dos veces procesa una vez.
- **Prueba:** P-129, P-130.

## Fase 8. Cierre

### Paso 33. README final [núcleo]
- **Construye:** qué es, demo y video, cómo funciona con los flujos, arquitectura en una imagen, cómo correrlo, cómo encaja en Blinka, índice de docs.
- **Hecho cuando:** una persona que no conoce el proyecto lo corre en local siguiendo el README sin preguntar nada.

### Paso 34. Video [núcleo]
- **Construye:** menos de tres minutos, en español con subtítulos, sobre la URL de producción, siguiendo el guion de la sección 9.
- **Hecho cuando:** está subido, el enlace abre sin autenticación y hay copia descargada en el equipo del pitch.

### Paso 35. Ensayos y plan B [núcleo]
- **Construye:** tres ensayos completos del pitch, uno con la clave del modelo inválida.
- **Hecho cuando:** la lista previa de la sección 10 está completa.

## 9. Guion del pitch (5 minutos)

1. Problema en 20 segundos: finanzas paga a mano, en otra moneda, y nadie recuerda por qué.
2. Reglas: mostrar el formulario y el YAML. "Esto es lo único que el agente obedece."
3. Procesar periodo: 25 facturas en vivo. Pendientes con pagadas, frenadas, escaladas.
4. Abrir un duplicado frenado: traza y explicación.
5. Abrir la factura con inyección de prompt: frenada, el documento quería saltarse las reglas.
6. Aprobar una escalada: checklist, firma, queda registrado quién.
7. Bajar el umbral de aprobación y ver qué cambiaría: replay muestra el diff.
8. Mandar una factura por Telegram y recibir el veredicto (si el paso 32 entró).
9. Cierre: el modelo lee y explica, las reglas deciden, la persona manda. Orden de pago lista en formato Blinka.

## 10. Lista previa al pitch

- Correr el set completo y confirmar cero falsos "pagar".
- Correr el set adversarial.
- Apagar y encender el kill switch en vivo y verificar que una factura válida queda escalada mientras está apagado.
- Reiniciar la demo al estado inicial y procesar el lote en menos de tres minutos.
- Enviar por Telegram una factura duplicada y recibir "frenada".
- Cambiar una regla, guardar, y verificar que el replay muestra el diff.
- Revisar que ningún log imprima contenido del documento.
- Grabar el video con la demo desplegada, no en local: hablado en español, subtítulos en español, menos de tres minutos. Dejarlo descargado en el equipo del pitch.
- Ensayar el pitch completo con la clave del modelo inválida y confirmar que el dataset responde desde la caché.
- Confirmar el tope de gasto en la clave de OpenRouter y el tope de facturas por visitante.
- Abrir la demo desde dos navegadores a la vez y verificar que cada uno tiene su empresa.

## 11. Orden de recorte si falta tiempo

1. Telegram (paso 32).
2. API de decisión (paso 31).
3. Orden de pago en PDF (paso 27): se muestra como JSON en el detalle.
4. Gráficos de métricas: quedan las tarjetas.
5. Bandeja simulada: queda la subida y el lote.

Nunca se recorta: el motor, las invariantes, el registro, la aprobación con checklist, el detalle con evidencia, el replay, la regresión en CI.

## 12. Pendientes para arrancar

- Identificadores exactos de Haiku 5.5 y Sonnet 5.5 en OpenRouter (se confirman al configurar).
- Cuenta en Turso y en Vercel conectadas al repo.
- Tope de gasto mensual configurado en la clave de OpenRouter.
- Token de un bot de Telegram nuevo para Yunque (solo para el paso 32).
