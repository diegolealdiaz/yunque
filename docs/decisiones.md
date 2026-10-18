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

**Decisión.** Prohibido flotante en el camino del dinero. Una sola función de parseo y normalización. Presupuesto agregado en USD con tasas fijas del set (D22).

## D5. Historial inmutable y transiciones atómicas

**Decisión.** Políticas, decisiones, aprobaciones y bitácora son append-only. Las transiciones usan compare-and-swap en la base. La reserva de presupuesto es un UPDATE condicional en la misma transacción que la decisión. Una reevaluación es una decisión nueva que referencia a la anterior.

## D6. Aprobación humana con checklist y firma del contenido exacto

**Decisión.** Aprobar exige marcar verificaciones concretas. La aprobación firma hash del documento, monto, beneficiario, cuenta y versión de política. Solo un humano convierte escalar en pagar. Tres cosas nunca las relaja una regla: alta de beneficiario, cambio de cuenta, liberación de un pago escalado.

## D7. Infraestructura mínima: funciones sin estado, una base relacional, una tabla como cola

**Decisión.** Next.js en Vercel, Turso para datos, Vercel Blob para archivos. Tabla outbox para las notificaciones. Sin Redis, sin broker, sin microservicios, sin multirregión.
**Consecuencia.** Un solo despliegue. Camino de escala documentado en `arquitectura.md`. El lote no necesitó cola: la pantalla lo recorre una factura por petición, cada una con su llave de entrega, así que un corte se retoma reenviando lo que faltó. La tabla de trabajos que se previó para él se quitó sin haberse usado. En local los archivos se guardan en disco; desplegado, en Vercel Blob (D27).

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

## D15. La empresa sale de una cookie firmada desde la primera pantalla con datos

**Contexto.** El plan dejaba la empresa por visitante para el despliegue (paso 29). Pero toda pantalla y toda acción necesitan saber de quién son los datos, y construirlas leyendo "la única empresa" obligaría a rehacerlas después.

**Decisión.** Desde el paso 20, el proxy entrega a cada visitante una cookie firmada con HMAC (`SESSION_SECRET`), y el servidor saca la empresa solo de esa firma verificada; al primer acceso siembra su copia de la empresa ficticia con el historial. Fuera de la demo, la empresa es la base. Ninguna ruta acepta un identificador de empresa del cliente, y una factura de otra empresa responde igual que una inexistente. En la misma pieza se fija la política de seguridad de contenido: scripts solo propios con nonce por petición, sin incrustar la app en otros sitios.

**Consecuencia.** Las pantallas se renderizan por petición, nunca al compilar. Cuántas empresas se siembran por día lo limita un tope (D27).

## D16. La aprobación se verifica en el servidor; en la demo, el aprobador se elige

**Contexto.** Aprobar es lo único que convierte una escalada en pago. La pantalla puede ser manipulada: un formulario puede llegar con otro monto, otra cuenta o en nombre de otra persona. La demo no tiene inicio de sesión.

**Decisión.** El servidor firma con HMAC (`APPROVAL_SIGNING_SECRET`) el contenido exacto que la persona revisa: documento, monto, beneficiario, cuenta y versión de política. Al aprobar comprueba la firma y además recalcula ese contenido desde la base; cualquier diferencia invalida la aprobación. Exige el checklist completo, revalida antes del efecto (el mismo cobro no se pagó por otra vía, la política sigue vigente y tiene los pagos encendidos, presupuesto y saldo alcanzan con `UPDATE` condicionales) y escribe todo en una transacción en la que la primera resolución gana. Aprobar crea una decisión nueva `pagar` con actor humano que apunta a la escalada; rechazar exige motivo y es final. Un beneficiario fuera de la lista no se aprueba: primero se da de alta.

En la demo, quién aprueba es una persona elegida de la lista de aprobadores de la política (clave protegida), guardada en una cookie firmada con otro secreto (`SESSION_SECRET`) y verificada contra la política en cada acción. No es autenticación: en producto la reemplaza el inicio de sesión, sin cambiar el caso de uso. Mientras no exista, la configuración rechaza `DEMO_MODE=false` en producción: la única forma de desplegar es la demo, donde cada visitante tiene su propia empresa ficticia.

**Consecuencia.** Un formulario alterado en el navegador recibe "el contenido a aprobar no tiene una firma válida", y una revisión vieja recibe "la factura cambió desde que la revisaste".

## D17. Corregir a mano nunca paga solo, y reevaluar nunca ablanda

**Contexto.** Una persona puede corregir los campos de una escalada (un total ambiguo, un documento que el Lector no entendió) y reevaluar con la política vigente. Si su corrección pudiera terminar en `pagar` directo, quien corrige estaría aprobando su propio pago. Y al reevaluar, una señal que solo venía del cuerpo de un correo (que no se guarda) se perdería.

**Decisión.** Los campos corregidos quedan con origen "humano": el Verificador no los exige como cita del documento, porque la evidencia es la persona y queda en la decisión. Si con ellos el motor diría `pagar`, escala con `human_correction`, y la aprueba otra persona de la lista: quien corrigió no puede aprobar su propia corrección. Quién corrigió se lee de la bitácora (`invoice.corrected`), no del actor de la última decisión, así una reevaluación posterior o el replay de una política no lo borran. Una señal de instrucciones sospechosas de la decisión anterior se arrastra siempre a la nueva. Una factura ya pagada no se reevalúa, para no comprometer dos veces.

**Consecuencia.** La semilla trae dos aprobadores ficticios para mostrar los cuatro ojos. Corregir y reevaluar comparten con `processInvoice` el mismo tramo de evaluar y registrar (`src/usecases/decide.ts`).

## D18. Ver qué cambiaría es exacto, y guardar reevalúa solo lo abierto

**Contexto.** El momento que muestra que las reglas mandan es cambiar la política y ver su efecto. Si la vista previa evaluara cada factura por separado, prometería pagos que al guardar no cabrían en el presupuesto, porque el replay los procesa en orden y cada pago consume.

**Decisión.** La vista previa reevalúa en memoria, sin escribir nada, las facturas abiertas (escaladas que esperan a una persona y frenadas) en el mismo orden que el replay, y acumula lo que cada `pagar` comprometería de presupuesto y saldo (nada en modo de prueba, igual que el replay); cada pago previsto cuenta ya como pagado en el historial de las facturas siguientes. Guardar exige un aprobador de la lista y que la versión vigente siga siendo la que se editó (si otra persona guardó o cambió un interruptor antes, se rechaza en vez de pisarla), crea la versión v+1 firmada, aplica el límite del presupuesto del periodo y reevalúa esas mismas facturas; la bitácora registra `policy.saved` y `policy.replayed` con lo que cambió; una factura que no se pudo reevaluar queda como estaba y se cuenta como fallida, sin cortar el replay de las demás. Las pagadas nunca se reevalúan. Los interruptores (pagos, modo de prueba, autonomía) crean su propia versión con `controls.changed` y no reevalúan: cada factura afectada se reevalúa desde su detalle.

**Consecuencia.** Lo que la vista previa anuncia es lo que el replay hace: un pago nuevo puede dejar sin presupuesto a la siguiente y la vista previa ya lo muestra. El formulario y el YAML editan el mismo documento en el navegador; el servidor valida con el esquema estricto y nunca toma del editor las claves protegidas ni los controles.

## D19. Métricas mide la decisión del agente con el código de la evaluación

**Contexto.** La pantalla de Métricas y `npm run eval` tienen que dar los mismos números sobre la misma base; si cada una armara sus filas a su manera, divergirían en silencio. Además, una factura que una persona aprueba, corrige o reevalúa con otra política tiene varias decisiones, y solo una es lo que hizo el agente solo.

**Decisión.** La fila de cada caso se arma en `src/eval/rows.ts` y la comparten la evaluación y la pantalla, con el mismo `computeMetrics`. Los números del set (autonomía, falsos "pagar", exactitud, costo y tiempo) se miden sobre las facturas del lote que tienen caso en el dataset, con la decisión del agente al recibirlas: la de actor agente sin decisión anterior. Una factura subida a mano no tiene veredicto esperado y no entra. Los números de operación (escaladas esperando, presupuesto por moneda, reglas que más dispararon) salen de la decisión vigente de todas las facturas, en el periodo del presupuesto. Cada número trae la lista de facturas que lo componen y la pantalla la abre con `?ver=`.

**Consecuencia.** Cambiar la política no reescribe la autonomía pasada, y bajar la autonomía exige que el agente decida peor, no que una persona corrija. El tiempo de decisión se mide de la recepción a la decisión guardada, así que difiere en milisegundos del que mide `eval` alrededor del proceso; por eso P-91 no compara latencias.

## D20. Una sola lectura de salud, con tres niveles

**Contexto.** La salud aparece en tres lugares: `/api/health` para un monitor, la pantalla de Salud y el punto de la barra lateral. Si cada uno la calculara a su manera, podrían decir cosas distintas. Además, en la demo cada visita sin cookie siembra una empresa, y un monitor que consulta cada minuto no debe crear una empresa por consulta.

**Decisión.** Los tres leen `checkHealth`. Son críticos la base, la política vigente y el proveedor del modelo, que cuenta como caído si no hay clave o si su última llamada falló hace menos de media hora: si uno falla, el estado es `falla` y la API responde 503. Las escaladas con la espera vencida y los avisos sin entregar no detienen al agente, pero alguien tiene que mirarlos: el estado es `degradada` y la API responde 200. La API usa la empresa de la cookie si ya existe y nunca siembra una; sin empresa, revisa solo lo del sistema. Nunca expone secretos ni el mensaje del driver de la base, solo estados y conteos.

**Consecuencia.** Sin la clave del modelo, la salud está en rojo aunque la demo funcione, porque toda factura se escala como ilegible: es exactamente lo que hay que ver.

## D21. Los avisos se entregan al responder; Telegram es simulado mientras no haya bot

**Contexto.** La decisión encola sus avisos en su misma transacción (outbox). Falta quién los entregue. Un proceso aparte que corra todo el tiempo no existe en funciones sin estado, y el canal de Telegram es el primer recorte del plan.

**Decisión.** Cada ruta o acción que crea decisiones entrega los avisos pendientes de la empresa después de responder (`after`), así quien decide no espera al canal. Cada aviso se reclama con comparación y cambio antes de entregarlo; si el canal falla, se reintenta con espera creciente y al quinto intento queda fallido, con su evento y visible en la salud. El aviso en pantalla se entrega al dejar constancia, porque la decisión ya aparece en Pendientes y en el detalle. Sin bot configurado, o sin chats conectados, el aviso por Telegram se entrega a un canal simulado y el evento lo marca `simulated: true`; con el bot, llega a los chats conectados (D24). Los correos de la bandeja simulada llevan un Message-ID estable y su llave de recepción sale de él; un caso de correo del lote usa esa misma llave, así el correo se recibe una vez por cualquiera de los dos caminos. Un correo sin adjunto se recibe: su documento es el mensaje, no tiene páginas y se escala como ilegible sin llamar al modelo.

**Consecuencia.** Un reintento que vence ocurre en la próxima entrega de esa empresa, no a la hora exacta; en el despliegue, un cron cubre ese hueco. El canal real de Telegram (D24) solo cambió su función de envío.

## D22. Tasas de cambio fijas y a la vista en esta versión; diarias y registradas en producción

**Contexto.** Los límites por pago, el umbral de aprobación, el presupuesto y el tope absoluto van en USD, y las facturas llegan en seis monedas. La tasa decide pagos: si la tasa del COP subiera de 4.150 a 6.000, una factura de 25.000.000 COP pasaría de unos 6.024 USD a unos 4.167 USD, quedaría bajo el umbral y se pagaría sin aprobación. Una tasa editable como un campo cualquiera sería una puerta para saltarse los límites.

**Decisión.** En esta versión cada empresa tiene una tabla de tasas fija, guardada con ella y con su fecha de referencia. Los montos son enteros y la comparación contra un límite es exacta, sin redondear; el valor redondeado solo se muestra. Las tasas no se editan desde la aplicación: Reglas las muestra en una pestaña de solo lectura y el detalle de cada factura en otra moneda dice con qué tasa se convirtió. Así la demostración es reproducible y nadie cambia qué se paga sin firmar una política.

**Lo correcto en producción.** Las tasas vienen a diario de un proveedor oficial (por ejemplo, la TRM del Banco de la República o las tasas de referencia del BCE), con su fecha y su fuente. Cada decisión guarda la tasa y la fecha que usó, así su explicación sigue siendo exacta aunque la tasa cambie después y el replay reproduce el mismo veredicto. Si el proveedor falla o la tasa del día no llegó, el agente no paga lo que dependa de ella: escala a una persona. Un cambio brusco de tasa frente al día anterior también escala. Editarlas a mano, si hiciera falta, pasaría por la misma firma, versión y vista previa que la política.

**Consecuencia.** Hoy una tasa desactualizada se ve en pantalla, pero no se corrige sola; mientras tanto, la fecha "fijas al" deja claro con qué tasa se decidió.

## D23. Correo real en la demo, solo con acceso de cliente y con topes antes de gastar

**Contexto.** Probar la demo con una factura propia, enviada desde el propio correo, convence más que cualquier dataset. Pero una dirección pública que pone a trabajar al modelo es una puerta abierta al gasto y al abuso, y la demo no tiene inicio de sesión.

**Decisión.** Un proveedor de correo entrante (Postmark) recibe los correos y llama al webhook `/api/correo/entrante` con cada uno. Nada se procesa sin pasar seis capas, en este orden:

1. **Acceso de cliente.** La dirección solo aparece para quien escribe el código en "Probar con tu factura". Tras 5 intentos fallidos en 15 minutos, la empresa queda bloqueada hasta que pase la ventana, ni siquiera el código correcto pasa. El código (`DEMO_ACCESS_CODE`) vive en una variable de entorno, se entrega a los clientes por fuera del repo y abre también Telegram (D24); cambiarlo anula el anterior. El acceso dura 72 horas (configurable) y escribir el código otra vez no lo extiende.
2. **Dirección imposible de adivinar y con vencimiento.** Cada visitante recibe su dirección `local+token@dominio`, con un token de 60 bits de azar que apunta a su propia empresa. Vence con el acceso. Un correo a un token desconocido se ignora sin tocar nada; uno a una dirección vencida queda en la bitácora de esa empresa y no se procesa.
3. **Topes antes de llamar al modelo.** Máximo de correos por dirección al día (10) y de toda la demo al día (60), además de los topes de facturas que ya tenía la demo. Cada correo a una dirección conocida deja un recibo (`inbound_receipts`), y contar el cupo y escribir el recibo ocurren en la misma transacción de escritura: una ráfaga de correos simultáneos no pasa del tope. Un correo sobre el tope queda en la bitácora como "Correo no procesado", con el motivo, y no gasta. La bitácora lo dice una vez por motivo y día, y pasados 20 rechazos en el día ya no se escribe nada: quien conoce una dirección vencida no puede llenar la base.
4. **Techo de gasto del modelo.** La clave de OpenRouter lleva un límite de gasto (10 USD sugerido). Si todo lo demás fallara, el proveedor deja de responder y no se cobra más. Protege también la subida y los botones de ejemplo. Se configura en el panel del proveedor, no en el código.
5. **Interruptor.** `INBOUND_EMAIL_ENABLED=false` lo apaga de inmediato: las dos rutas responden 404 y el botón desaparece.
6. **Solo recibe.** Yunque nunca responde ni reenvía un correo, así que no sirve para mandar correo a nombre de nadie. El correo es contenido no confiable como en todo canal: si el cuerpo trae instrucciones para el agente, la regla de instrucciones sospechosas lo frena.

Detalles que sostienen las capas: el webhook exige autenticación básica con un secreto propio, comparado en tiempo constante, y lee el cuerpo con un tope de bytes. Admite y reserva el cupo antes de responder, responde de inmediato y procesa después de responder, así el proveedor no espera la lectura ni reintenta. La llave de recepción sale del identificador que el proveedor da al correo (`inbox:pm-<id>`): un reintento del proveedor encuentra su recibo, recibe la misma respuesta y no duplica la factura. Si el proceso falla después de responder, queda en la bitácora como "Correo no procesado" con el motivo, en lugar de perderse. La ruta solo autentica, valida y delega; el flujo vive en `src/usecases/inbound-email.ts`, con pruebas. El documento es el primer adjunto que, por contenido, es PDF, PNG o JPEG; un correo sin adjunto válido entra igual y escala como "no es una factura" sin llamar al modelo. El registro de un correo rechazado no guarda el remitente ni el asunto.

**Por qué este proveedor y no un orquestador de flujos.** Un proveedor que entrega el correo directo al webhook no necesita intermediario. Un orquestador de flujos sería otro servicio que pagar o mantener, y solo reenviaría lo mismo. El plan gratuito del proveedor alcanza para la demo y da una dirección de entrada sin dominio propio. Con un dominio propio, el enrutamiento de correo de Cloudflare con un Worker es la alternativa equivalente.

**Consecuencia.** Los topes aguantan correos simultáneos porque la base serializa las transacciones de escritura: si dos instancias cuentan a la vez, la segunda reintenta con la cuenta nueva. El techo de gasto del proveedor sigue siendo la última capa por si algo de esto fallara. Vercel limita el cuerpo de una petición a 4,5 MB, así que un adjunto de más de unos 3 MB no llega. Las empresas de los visitantes todavía no se borran solas: queda para el cron del despliegue (paso 29). En producción, con inicio de sesión, cada empresa tendría su dirección fija y una lista de remitentes autorizados.

## D24. Telegram como notificador y como canal de entrada, con el mismo acceso de cliente

**Contexto.** Lo que se sale de las reglas espera a una persona, y esa persona no está mirando la pantalla de Pendientes. El valor está en avisarle en el momento, por un canal que ya usa. Enviar una factura desde el teléfono es, además, la forma más directa de probar el agente. Un bot público, en cambio, es otra puerta al gasto y al abuso.

**Decisión.** Un bot de Telegram con dos funciones:

1. **Notificador.** Cuando la empresa tiene un chat conectado, cada decisión que le importa a una persona (una escalada, una frenada o una aprobación) **sobre una factura que entregó una persona** (subida, correo real o el bot) encola un aviso por Telegram en la misma transacción que la decisión. Un pago que el agente hizo solo dentro de las reglas no interrumpe a nadie. Las facturas de ejemplo de la demo (lote y bandeja simulada) no se avisan una por una, aunque su canal sea correo o chat: al terminar el lote llega un solo resumen ("33 facturas: 15 pagadas, 8 esperan tu decisión, 10 frenadas"). Quién entregó la factura se sabe por su llave de recepción, no por su canal. El aviso dice qué pasó, de quién, cuánto y por qué, con las mismas razones en lenguaje simple de la pantalla, y un botón al detalle si hay URL pública. Lo entrega la cola de avisos con reintentos (D21).
2. **Entrada.** El chat conectado envía una factura en PDF o foto; pasa por `processInvoice` con la llave `telegram:<update_id>`, y su veredicto llega como cualquier aviso.

Protecciones, las mismas capas que el correo (D23):

- **Conexión con el acceso de cliente.** Con el acceso vigente, "Conectar Telegram" genera un enlace `t.me/<bot>?start=<token>`: un solo uso, 80 bits de azar, vence en una hora o con el acceso.
- **El bot solo atiende chats conectados.** A los demás les responde que es privado, sin gastar nada. No atiende grupos ni canales. `/salir` desconecta el chat.
- **Webhook autenticado.** Telegram manda el secreto configurado en `X-Telegram-Bot-Api-Secret-Token`, comparado en tiempo constante. La ruta responde enseguida y atiende después.
- **Cupo por chat** (10 facturas al día), contado y reservado en la misma transacción que registra el `update_id`: una ráfaga no pasa del tope y un reintento de Telegram no procesa dos veces. Pasados 20 rechazos del chat en el día, ya no se escribe nada. Siguen valiendo los topes de facturas de la demo y el techo de gasto del modelo.
- **El bot solo escribe a chats conectados,** y todo valor de afuera va escapado en el HTML del mensaje.

**Lo que queda fuera a propósito: aprobar desde el chat.** Un botón "Aprobar" en Telegram se saltaría el checklist y la firma, y sin inicio de sesión no hay forma segura de saber quién lo aprieta. El botón abre el detalle, donde están el checklist, la firma y los cuatro ojos. En producción, con identidad verificada, aprobar desde el chat podría permitirse hasta cierto monto.

**Por qué Telegram y no WhatsApp.** Telegram es gratis, el bot se crea en minutos y admite botones sin trámite. WhatsApp cobra por conversación y exige aprobación del proveedor y plantillas aprobadas. Es el canal natural de una empresa en la región, y entraría como otro adaptador sobre la misma cola de avisos.

## D25. El historial de ejemplo trae sus documentos, generados una vez y servidos desde el dataset

**Contexto.** Las 24 facturas de julio a septiembre existen para que las reglas de historial (primer pago, monto atípico, duplicados) tengan con qué comparar. Se sembraban sin archivo ni lectura: al abrir una, el detalle no mostraba documento ni campos, y la que se frenó no decía por qué. Para un cliente, una factura frenada sin motivo es justo lo contrario de lo que Yunque promete.

**Decisión.** `npm run dataset` pinta cada factura del historial con la plantilla de su beneficiario (partiendo de su caso del lote: mismo NIT, cuenta y descripción con el mes de la factura) y la pasa una vez por la misma ingesta que una factura real: PNG por página y posición de cada carácter. Escribe todo en `generado/historial/` con un índice (`documentos.json`) que lleva además la lectura ideal. La semilla solo lee ese índice: las facturas apuntan a llaves `muestra/...`, que el almacenamiento sirve de solo lectura desde el dataset que viene con la app, así crear una empresa de ejemplo no renderiza nada ni escribe archivos. Las que no se pagaron declaran en `historial.json` la regla que las decidió, y la semilla escribe su hallazgo con los mismos valores, formato y mensaje que el motor; la aprobación de una persona queda como su propio evento.

**Consecuencia.** El detalle, la bitácora y Pendientes tratan igual al historial y al lote. Como el historial no pasó por el motor, no guarda el registro de los demás controles, y la pantalla lo dice en vez de mostrar "Pasó X de Y". Los PDF del historial entran en la prueba de generación (P-51) y el recorrido completo en P-145. En el despliegue, `data/dataset/generado` va en el paquete de la función (D27).

**Identidad.** Cada cliente tiene su propia empresa de ejemplo (la cookie de su navegador), y el enlace conecta su chat con esa empresa: el bot identifica a la persona por su chat. Los avisos de una empresa solo van a sus chats; lo que pase en la empresa de otro cliente nunca le llega.

**En producción.** Con inicio de sesión, cada usuario conecta su propio chat y elige qué recibe: solo lo que le toca aprobar según su rol, las frenadas por riesgo, o un resumen diario.

**Consecuencia.** Con varios chats conectados, un reintento del aviso puede repetirlo en los que ya lo recibieron: se prefiere un aviso repetido a uno perdido. Un rechazo no genera aviso, porque no crea una decisión nueva. El resumen de ejemplos no pasa por la cola: se puede volver a pedir corriendo el lote otra vez.

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


## D26. El Lector es Claude Haiku 5.5, elegido midiendo, con todo lo nuestro en el mensaje de sistema

**Contexto.** El modelo se había elegido por precio sin medirlo, y el set de regresión solo había corrido con el Lector ideal. Al conectarlo de verdad aparecieron tres fallas nuestras, no del modelo: el tope de respuesta (1.500 tokens) cortaba todas las lecturas, porque una factura con sus citas pide entre 1.700 y 2.000; el prompt metía una indicación nuestra dentro del bloque del documento, y el modelo la reportaba, con razón, como instrucción sospechosa; y la lista de sospechas ofrecía "monto en letras distinto", que la regla 5 llama ambigüedad.

**Decisión.** Se corrigió el prompt (`lector-v3`): toda indicación nuestra, incluida la forma de la salida, va en el mensaje de sistema y el mensaje del usuario lleva solo lo que vino de afuera; la salida es JSON compacto; una ambigüedad es un documento que muestra dos valores para un campo, no el formato de una fecha (se lee según el idioma y el país) ni el nombre corto y el completo de la misma persona; el monto en letras distinto es ambigüedad, no sospecha. El tope sube a 4.096 tokens. Con ese prompt se corrió el set de 33 facturas en vivo, sin segunda pasada, con tres candidatos:

| Modelo | Correctas | Falsos pagar | Normales pagadas | Campos | Costo por factura | Tiempo medio |
|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | 32/33 | 0 | 15/15 | 416/416 | 0,0012 USD | 6,9 s |
| Gemini 3.8 Flash | 31/33 | 0 | 15/15 | 406/416 | 0,0087 USD | 11,9 s |
| GPT-5.4 mini | 18/33 | 0 | 6/15 | 403/416 | 0,0052 USD | 4,1 s |

Haiku 5.5 queda como Lector y Sonnet 5.5 como segunda pasada, solo tras verificación fallida. Con esa configuración el set da 33/33, cero falsos "pagar" y cero escaladas de normales; sus respuestas quedan grabadas en `tests/fixtures/lector/lector-v3` y la evaluación corre sin red.

**Consecuencia.** Leer el lote de 33 cuesta unos 4 centavos de dólar. GPT-5.4 mini toma condiciones de pago comunes ("pago por transferencia") por órdenes al sistema aun con la regla explícita; Gemini es más caro y más lento sin leer mejor. Estas cifras son sobre facturas generadas por nosotros, con capa de texto y plantillas limpias: antes de prometerlas a un cliente hay que medir con facturas reales (fotos, escaneos, varias páginas, formatos de otros países).

## D27. Despliegue en Vercel: archivos privados en Blob, migraciones en el build y topes de la demo pública

**Contexto.** En Vercel el disco de las funciones es de solo lectura, el dataset de la demo se lee con rutas armadas en tiempo de ejecución que el build no rastrea, y la demo es pública: cada visitante nuevo siembra una empresa entera con su historial.

**Decisión.**
- Los originales y las páginas renderizadas van a un almacén **privado** de Vercel Blob (`BlobFileStorage`), con las mismas llaves que en disco. No tienen URL pública: el navegador recibe las páginas solo por la ruta que valida la empresa. Sin `BLOB_READ_WRITE_TOKEN` se usa el disco, y en Vercel la app no arranca sin él.
- El build de Vercel aplica las migraciones antes de compilar (`vercel.json`): nadie guarda el token de la base en su equipo para migrar.
- `outputFileTracingIncludes` lleva al paquete la empresa de ejemplo y el dataset (lote, historial con sus páginas, bandeja).
- Un tope de empresas de ejemplo nuevas por día (`MAX_DEMO_ORGANIZATIONS_PER_DAY`, 200). Quien ya tiene la suya sigue entrando; un visitante nuevo ve que la demo está llena por hoy. El conteo no va en transacción: es un freno contra el abuso, no una cuota exacta.
- Un cron diario (`/api/avisos`, con `CRON_SECRET`) entrega los avisos atrasados de todas las empresas. Cada decisión ya entrega los suyos al responder; el cron recoge los que esperan reintento. Es diario porque el plan gratuito de Vercel no permite más.

**Consecuencia.** Un aviso que falla puede esperar hasta el cron del día siguiente si nadie decide nada antes. Las ramas con migraciones nuevas las aplican al construir su vista previa sobre la misma base: una migración que borra datos no se sube sin probarla en local.

## D28. Lo que cambió al medir con facturas reales

**Contexto.** Se pasaron 15 facturas reales de un conjunto público de investigación (10 limpias y 5 escaneos degradados, en inglés) por el Lector. Leyó bien el total a pagar en todas las que procesó, tomó el neto y no el bruto, marcó como ambigua la que mostraba los dos, y reconoció como "no es factura" una certificación de emisiones. Aparecieron cuatro fallas que el dataset generado no tenía:
1. Escaneos con páginas enormes daban imágenes de 12 a 21 MB por página; el modelo no respondía en 90 segundos.
2. El símbolo "$" no dice qué moneda es. El Verificador pedía la segunda pasada en todas las facturas, y Sonnet tampoco lo puede saber: cada lectura costaba unas 25 veces más (0,03 USD en vez de 0,001).
3. 7 de 15 tenían más de 5 páginas y se rechazaban al entrar.
4. Una factura prepagada con total 0 rompía el esquema (el total debe ser positivo) y gastaba cuatro llamadas.

**Decisión.**
1. Ninguna página se renderiza con más de 1.568 px de lado (el modelo reduce a ese tamaño de todas formas), y una página que en PNG pasa de 1 MB se guarda en JPEG. Se agrega `jpeg-js` para codificarla.
2. La moneda citada con "$" vale si el documento la nombra en otra parte (código, "dólares", "pesos colombianos"). Si no, es ambigüedad entre las monedas que usan "$" y escala sin segunda pasada. Un símbolo de una sola moneda ("US$", "€", "R$") vale como cita.
3. El tope sube a 10 páginas.
4. Un total cero se registra como documento sin nada que pagar y escala; conserva las sospechas que traía.

**Consecuencia.** La moneda de una factura que solo dice "$" y no nombra la moneda la confirma una persona. Falta medir con facturas colombianas reales y con fotos de celular: las fotos se envían tal como llegan, dentro del tope de 5 MB.


## D29. Cuatro ojos al aflojar la política

**Contexto.** Una sola persona de la lista podía subir el umbral de aprobación, agregar un beneficiario o pasar una regla de frenar a escalar, y al guardar se reevaluaban las facturas abiertas: el mismo cambio que firmaba pagaba escaladas que esperaban a una persona. Es la vía más corta para pagar fuera de las reglas sin que nadie más lo vea.

**Decisión.**
- Un cambio que afloja la política no entra en vigor con una sola firma. Afloja: subir el límite por pago, el umbral o el presupuesto; cambiar el periodo del presupuesto; agregar beneficiarios permitidos; pasar una regla de frenar a escalar; ampliar una tolerancia o un atraso admitido; acortar una ventana de duplicados o de frecuencia; bajar la confianza mínima o quitar un campo crítico (`policyLoosenings`, en el dominio).
- Guardar un cambio así deja una propuesta en la bitácora (`policy.proposed`, con lo que afloja en palabras). La política vigente no cambia. Otra persona de la lista la aprueba y entonces se guarda la versión, firmada por quien la propuso, con la segunda firma en la nota y en la bitácora, y se reevalúan las abiertas. Quien la propuso no puede aprobarla. Cualquiera de la lista puede descartarla.
- Hay a lo sumo una propuesta abierta. Si entra otra versión mientras tanto, la propuesta vence: no se aprueba sobre una política que ya no es la que se miró.
- `savePolicy` exige la segunda firma él mismo: ninguna ruta guarda un cambio que afloja sin ella.
- Un cambio igual o más estricto se guarda directo, con una firma.

- Los interruptores siguen la misma regla: apagar los pagos, volver al modo de prueba o pasar el agente a recomendar es inmediato, con una firma, porque es la emergencia. Encender los pagos, salir del modo de prueba o dejar que el agente decida queda como propuesta (`controlsLoosenings`).

**Consecuencia.** La propuesta vive en la bitácora, que es append-only: no hace falta tabla nueva, y aprobar o descartar es otro evento. Una empresa con un solo aprobador no puede aflojar nada: es a propósito, y la lista de aprobadores es una clave protegida que no se cambia desde la pantalla.

## D30. Lo que cerró la revisión adversarial de los caminos a "pagar"

**Contexto.** Se recorrieron todos los caminos que escriben una decisión: procesar, aprobar y rechazar, corregir, reevaluar, guardar política, interruptores y canales. Se buscaba uno que terminara en "pagar" fuera de las reglas. Aparecieron dos que pagaban y tres que ablandaban lo que ve quien aprueba.

**Decisión.**
1. **No se borra un dato que el Lector leyó.** Vaciar el vencimiento de una factura vencida la sacaba de la regla de atraso y la pagaba con una sola persona. Las reglas de cuatro ojos solo cuentan los campos corregidos que tienen valor. Ahora vaciar un dato leído se rechaza: se corrige con el valor del documento.
2. **Una reevaluación arrastra lo que vieron todas las decisiones de la factura, no solo la última.** Una reevaluación que fallaba dejaba una escalada por error de proceso sin las sospechas de antes. La instrucción "ya aprobado por el CFO" del cuerpo de un correo, que no se guarda, se perdía, y la reevaluación siguiente pagaba.
3. **Los desacuerdos entre las dos pasadas del modelo quedan en la lectura guardada,** todos y no solo el primero. Se van únicamente cuando una persona fija ese campo.
4. **El modelo no puede declararse persona.** Todo campo que devuelve queda con origen "modelo". Un campo marcado como humano no se verifica contra el documento, y su ambigüedad desaparecía.
5. **Aprobar exige, dentro de la transacción, que la decisión vigente sea la que se firmó.** Antes solo se comparaba el estado, y una corrección simultánea deja la factura en el mismo estado con otro monto.

**Consecuencia.** Quedan dos límites conocidos y aceptados:
- **Un solo visitante cumple los cuatro ojos** eligiendo los dos nombres de la lista. En producción eso exige inicio de sesión.
- **Un documento sin capa de texto (foto o escaneo) no se contrasta con nada determinista.** Lo cubren la segunda pasada, los desacuerdos entre pasadas y el umbral de aprobación.

## D31. Registrar un proveedor desde su factura, y la doble firma como interruptor

**Contexto.** Proveedor nuevo es la escalada más común en cuentas por pagar, y también el caso de cualquier factura real que un cliente prueba en la demo. El agente la escalaba con el porqué, pero no había forma de registrar al proveedor: lo único posible era rechazar. Además, la doble firma (D29) era fija, y no toda empresa trabaja con dos aprobadores.

**Decisión.**
- **Registrar proveedor desde la factura.** El detalle de una factura escalada cuyo proveedor no está registrado ofrece "Registrar proveedor". El formulario viene prellenado con lo que leyó el agente (nombre, identificación, cuenta, titular y la forma de pago que sirve para la moneda). La persona lo revisa contra el documento y confirma que verificó los datos con el proveedor por un canal distinto a la factura.
- **Lo que se guarda.** El proveedor entra a la lista de permitidos en una versión nueva de la política y la factura se reevalúa con él.
- **Con la doble firma:** el proveedor queda sin verificar y la regla fija "beneficiario sin verificar" escala. Otra persona lo verifica al aprobar la factura, porque el checklist lo pide. Quien lo registró no puede verificarlo.
- **Sin la doble firma:** queda verificado por quien lo registra, y esa misma persona aprueba.
- **Desde ahí,** las facturas siguientes del proveedor se pagan solas dentro de las reglas.
- **Lo que no se registra:**
  - un proveedor con el nombre, la identificación o **la cuenta** de uno registrado. Una cuenta conocida con otro nombre es una forma común de fraude;
  - un nombre parecido a uno registrado, salvo que la persona confirme expresamente que es otra empresa.
- **La doble firma es un interruptor de Reglas, encendido por defecto.** Encenderla es inmediato. Apagarla afloja el control, así que la confirma otra persona de la lista una vez. Con ella apagada, una sola persona puede aflojar reglas, encender interruptores, registrar proveedores y aprobar lo que corrigió.

**Consecuencia.** Registrar un proveedor sin verificar no puede llevar a un pago automático: la regla de beneficiario sin verificar escala siempre. Por eso agregarlo a la lista de permitidos no pasa por la propuesta de política de D29. En la bitácora queda quién registró al proveedor, con qué cuenta, y quién lo verificó.
