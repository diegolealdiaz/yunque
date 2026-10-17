# Decisiones de arquitectura

> Registro corto de las decisiones que dan forma a Yunque. Cada una con contexto, opciones y por qué. Si una decisión cambia, se agrega una entrada nueva que referencia a la anterior; no se edita la vieja.

## D1. El modelo extrae y explica; el código decide

**Contexto.** El criterio descalificante del reto es aprobar un pago fuera de las reglas. La explicabilidad exige que cualquiera entienda el registro.
**Opciones.** Agente de modelo con herramientas que decide; modelo que propone y código que verifica; sin modelo; modelo solo para extraer.
**Decisión.** El modelo produce campos tipados con evidencia y confianza, y prosa explicativa. El veredicto sale de una función pura y determinista. Las salidas del modelo solo pueden endurecer la decisión, nunca relajarla.
**Consecuencia.** Mismo documento, misma política y mismo ledger dan siempre el mismo veredicto. Cambiar de modelo no cambia la seguridad.

## D2. Catálogo fijo de reglas con parámetros, no un lenguaje de políticas

**Contexto.** La empresa define sus reglas desde una pantalla simple.
**Opciones.** Lenguaje de políticas declarativo de terceros; reglas escritas en código; catálogo de reglas con parámetros editables.
**Decisión.** Catálogo de reglas con identificador, parámetros, severidad y acción si falla, editable desde un formulario con vista YAML. Versiones inmutables firmadas.
**Consecuencia.** Agregar una regla es agregar un módulo y una fila en el formulario. Migrable a un motor de políticas externo sin tocar el resto.

## D3. Roles con nombre, un solo cerebro determinista

**Contexto.** Tentación de modelar el sistema como varios agentes de modelo que conversan.
**Decisión.** Flujo fijo de roles (Lector, Verificador, Resolutor, Juez, Explicador, Notificador, Analista). Solo el Lector y opcionalmente el Explicador usan modelo. Nada de modelo a modelo.
**Consecuencia.** Latencia, costo y explicabilidad bajo control. "No entendí la factura" es un resultado tipado que escala a una persona, no un problema que otro modelo resuelve.

## D4. Dinero en enteros de unidad mínima con moneda obligatoria

**Decisión.** Prohibido flotante en el camino del dinero. Una sola función de parseo y normalización. Presupuesto agregado en USD con tasas fijas del set.

## D5. Historial inmutable y transiciones atómicas

**Decisión.** Políticas, decisiones, aprobaciones y bitácora son append-only. Las transiciones usan compare-and-swap en la base. La reserva de presupuesto es un UPDATE condicional en la misma transacción que la decisión. Una reevaluación es una decisión nueva que referencia a la anterior.

## D6. Aprobación humana con checklist y firma del contenido exacto

**Decisión.** Aprobar exige marcar verificaciones concretas. La aprobación firma hash del documento, monto, beneficiario, cuenta y versión de política. Solo un humano convierte escalar en pagar. Tres cosas nunca las relaja una regla: alta de beneficiario, cambio de cuenta, liberación de un pago escalado.

## D7. Infraestructura mínima: funciones sin estado, una base relacional, una tabla como cola

**Decisión.** Next.js en Vercel, Turso para datos, Vercel Blob para archivos. Tabla outbox para el lote y las notificaciones. Sin Redis, sin broker, sin microservicios, sin multirregión.
**Consecuencia.** Un solo despliegue. Camino de escala documentado en `arquitectura.md`.

## D8. Modelo barato por defecto, caro solo como segunda pasada

**Decisión.** Haiku 5.5 extrae. Sonnet 5.5 solo cuando falla una verificación determinista, una vez por factura. Ambos por variable de entorno. Nunca en bucle periódico. Costo acumulado por paso y visible por factura.

## D9. Identificadores ULID más referencia legible

**Decisión.** ULID para facturas, decisiones y eventos; referencia `DEC-2026-10-0007` para personas. Sin autoincremento expuesto.

## D10. Canales como adaptadores de una sola función

**Decisión.** Subida, lote, bandeja simulada, Telegram y API terminan en `processInvoice`. Sin extensión de navegador: es un canal más y no mejora la decisión.

## D11. El documento se procesa en el servidor; el navegador solo ve imágenes

**Contexto.** Las facturas llegan de terceros y son contenido no confiable. Un PDF puede llevar scripts, enlaces, adjuntos y texto invisible. Las interfaces de revisión suelen abrir el PDF en el navegador con un visor o un iframe.

**Opciones.** (a) Visor de PDF en el cliente. (b) Renderizar cada página a PNG en el servidor al ingerir y servir solo la imagen y el texto extraído.

**Decisión.** (b), con PDFium en WebAssembly dentro de la función de ingesta. Se guardan el texto, una imagen por página y las posiciones del texto. El visor de la interfaz es una imagen con las citas resaltadas encima.

**Consecuencia.** Cero código de parseo de PDF en el navegador, la pantalla de detalle es idéntica para PDF, imagen y correo, y la evidencia se puede resaltar sobre la página. Cuesta una conversión por documento en la ingesta, que se hace una sola vez y se cachea por hash.

## D12. La caché del Lector incluye el prompt construido

**Contexto.** El mismo PDF puede llegar adjunto a dos correos distintos, uno normal y otro que dice "ya aprobado por el CFO". El cuerpo del canal entra al prompt.

**Decisión.** La llave de caché es hash del documento, versión de prompt, versión de esquema, modelo y hash del prompt construido sin el canario. Una lectura ilegible o en la que se filtró el canario no se cachea. Escribir el registro de llamadas o la caché es best-effort: si falla, la lectura sigue.

**Consecuencia.** Dos canales distintos son dos lecturas; la señal del canario se repite en cada reproceso. Cuesta una llamada más cuando el mismo documento llega por dos canales, que es justo el caso que hay que mirar.

## D13. Idempotencia por entrega, no por archivo

**Contexto.** El mismo PDF reenviado por otro correo es el duplicado clásico que hay que frenar y mostrar. Si el hash del archivo fuera único en la base, la segunda entrega no podría registrarse como factura y el duplicado nunca tendría su decisión ni su explicación. A la vez, un reintento de red o un doble clic no deben crear dos facturas.

**Opciones.** (a) Hash del archivo único: la segunda entrega se descarta sin decisión. (b) Sin unicidad: cada reintento crea otra factura. (c) Una llave de recepción por entrega (id del correo, update de Telegram, caso del lote, llave de idempotencia de quien sube), única por organización, y el hash del archivo como índice no único.

**Decisión.** (c). La misma entrega dos veces devuelve la factura existente sin procesarla otra vez. El mismo archivo por otra entrega es otra factura que el motor frena con `duplicate_invoice`. Por subida o lote la caché del Lector evita pagar el modelo otra vez; por correo o chat el cuerpo del mensaje entra al prompt, así que se vuelve a leer (D12). Una entrega que quedó `fallida` o abandonada en `procesando` se reintenta reenviándola con la misma llave. Antes de registrar un `pagar`, la transacción vuelve a buscar el mismo cobro: dos archivos distintos del mismo cobro procesados a la vez no se pagan los dos.

**Consecuencia.** El duplicado exacto aparece en pendientes como frenado, con su traza. Cada canal debe entregar una llave estable con `receiptKeyFor(canal, id)`, que convierte en hash los identificadores con caracteres no seguros como el Message-ID de un correo; la subida en pantalla genera una por archivo elegido.

## D14. Caché del Lector compartible en la demo

**Contexto.** En la demo pública cada visitante recibe su propia copia de la empresa. Si la caché del Lector fuera por organización, cada copia volvería a pagar el modelo por las mismas facturas del dataset, y sin proveedor la demo no tendría plan B.

**Decisión.** La caché vive en su propia tabla, direccionada por contenido: la llave es el hash del documento, la versión de prompt y de esquema, el modelo y el hash del prompt construido. Una columna de ámbito vale el id de la organización en producto y un ámbito compartido en la demo. Es la única tabla sin `organization_id`, y no guarda nada que no se derive del documento mismo.

**Consecuencia.** Procesar el dataset en una copia nueva no llama al modelo. En producto, una empresa nunca lee lecturas de otra.

## Alternativas consideradas y descartadas

| Alternativa | Qué sería | Por qué no |
|---|---|---|
| Agente con herramientas que decide | Un bucle de modelo con herramientas `leer`, `buscar_vendor`, `pagar`, que razona y actúa | No determinista. El mismo documento puede dar veredictos distintos. Viola el criterio descalificante y la explicabilidad |
| El modelo propone el veredicto y el código lo verifica | Dos fuentes de verdad. Cuando discrepan, hay que explicar por qué | Añade costo y confusión sin añadir seguridad. La versión útil ya existe: banderas del modelo que solo endurecen |
| Sin modelo: OCR y plantillas por proveedor | Determinismo total | Falla con facturas heterogéneas, correo y chat. No explica. Se conserva la parte buena: el texto de PDFs se lee sin modelo |
| Motor de políticas estándar (lenguaje de políticas de terceros) | Reglas en un lenguaje declarativo externo con evaluador propio | Curva de aprendizaje, dependencia, y el formulario de finanzas mapea mal a un lenguaje general. Se elige un catálogo fijo de reglas con parámetros, que es lo que el formulario necesita. Migrable después |
| Varios agentes de modelo coordinados | Lector, arquitecto y notificador como modelos que se pasan mensajes | Latencia, costo y explicabilidad degradada. Los roles existen, pero solo el Lector usa modelo |
| Orquestador durable externo | Un servicio de flujos durables con pasos, reintentos y esperas humanas | Buena opción posterior. Para la demo, la tabla outbox y el estado en base cubren lo mismo sin otra dependencia |
| OCR especializado de terceros | Servicio dedicado para escaneos difíciles | Otro proveedor y costo. El set de la demo usa PDFs con texto e imágenes legibles. Queda como adaptador futuro del Lector |
| Decidir por corrida de pagos en vez de por factura | Agrupar aprobados por fecha y ruta y optimizar flujo de caja | Útil en producto real. Para el reto, la unidad de decisión es la factura. La fecha programada (A2) deja la puerta abierta |
| Extensión de navegador como canal | Capturar facturas desde el correo web | Canal sin impacto en la decisión. Se descarta |
| Visor de PDF en el navegador para la factura original | Es lo habitual en herramientas de revisión | Expone al navegador a contenido no confiable y duplica la lógica de resaltado por formato. Se renderiza en el servidor |

