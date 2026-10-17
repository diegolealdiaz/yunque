# Plan de pruebas

> Cómo verificamos que Yunque hace lo que dice `arquitectura.md` y nada más. Cada paso de `plan.md` referencia pruebas de este catálogo por identificador. Un paso no está terminado hasta que sus pruebas están en verde.

## 1. Principios

1. **La decisión se prueba sin red.** El motor es puro: se prueba con miles de casos generados en milisegundos. Nada del modelo, de la base ni de Vercel entra en esas pruebas.
2. **Lo que puede causar un pago indebido se prueba por propiedad, no por ejemplo.** Las once invariantes de seguridad se verifican con generadores de casos aleatorios, porque un ejemplo escrito a mano solo prueba lo que ya imaginamos.
3. **El modelo se prueba con sus salidas grabadas.** CI nunca llama al modelo. Las salidas reales se graban como fixtures con el hash de la petición y la versión del prompt; una corrida en vivo se lanza a mano con `EVAL_LIVE=1` y regraba. Mientras no haya fixtures, `EVAL_SOURCE=ideal` corre el set con un Lector perfecto derivado del manifiesto: no mide al modelo, mide todo lo que viene después de él.
4. **Un falso "pagar" bloquea todo.** Es el único criterio descalificante del reto, así que es la única prueba que impide desplegar sin excepción.
5. **Cada regla tiene sus fronteras escritas.** Igual, uno más, uno menos, parámetro ausente, moneda distinta. Las reglas fallan en las fronteras, no en el medio.
6. **Las pruebas de interfaz son pocas y de flujo completo.** Seis recorridos que cubren el pitch. Lo demás lo cubren las pruebas de abajo.
7. **Lo que no se puede probar se declara.** La sección 7 lista lo que se verifica a mano y por qué.

## 2. Niveles y herramientas

| Nivel | Qué cubre | Herramienta | Corre en |
|---|---|---|---|
| Unitario | dominio, dinero, reglas, explicador, resolutor, detector | Vitest | cada commit, CI |
| Propiedad | invariantes del motor y del dinero | Vitest + fast-check | cada commit, CI |
| Pipeline | `processInvoice` con extractor simulado | Vitest | cada commit, CI |
| Base y concurrencia | transacciones, reserva, comparación y cambio | Vitest sobre SQLite en archivo temporal | cada commit, CI |
| Regresión | dataset y adversarial contra verdad esperada, fixtures del modelo | `npm run eval` | cada commit, CI |
| Modelo en vivo | extracción real, costo, latencia, regrabado de fixtures | `EVAL_LIVE=1 npm run eval` | a mano, al cambiar prompt, esquema o modelo |
| API | contratos de `/api/*` con peticiones reales al servidor de desarrollo | Vitest + fetch | CI |
| Interfaz | seis flujos del pitch | Playwright | CI, con el servidor local y la semilla |
| Seguridad | escape, inyección, archivos, cookie, topes | mezcla de niveles anteriores, marcados `@seguridad` | CI |
| Manual | lista previa al pitch | persona | antes del pitch |

Comandos: `npm test` (unitario, propiedad, pipeline, base), `npm run eval`, `npm run test:api`, `npm run test:e2e`, `npm run check` (typecheck, lint, test, eval, build). CI corre `check` y después `test:api` y `test:e2e`.

## 3. Catálogo de pruebas

Cada fila es una prueba o un grupo pequeño con un identificador estable. "Tipo" es el nivel de la sección 2.

### Cimientos

| Id | Verifica | Tipo |
|---|---|---|
| P-01 | `npm run check` pasa en el scaffold vacío; `tsc` en modo estricto sin `any` ni `as` de escape (regla de lint) | unitario |
| P-02 | Sin cada variable requerida, `loadConfig()` lanza error que nombra la variable; con `.env.example` completo carga; valores numéricos fuera de rango se rechazan | unitario |
| P-03 | Un commit con un test roto deja CI en rojo y Vercel no despliega; uno verde despliega preview | manual, una vez |

### Dominio

| Id | Verifica | Tipo |
|---|---|---|
| P-10 | Dinero: suma, comparación y conversión FX solo entre la misma moneda; mezclar monedas lanza; redondeo a unidad mínima documentado y estable; nunca aparece un `number` con decimales en el camino del dinero | unitario + propiedad |
| P-11 | Formateo: `4.800.000 COP`, `1,250.00 USD`, `R$` nunca; parseo inverso recupera el entero exacto | unitario |
| P-12 | Política: esquema estricto rechaza claves desconocidas, claves protegidas no editables desde el formulario, `on_fail` solo `frenar` o `escalar`, tope absoluto del sistema no sobrescribible, YAML y formulario producen el mismo objeto | unitario |
| P-13 | Identificadores: ULID monótono dentro del mismo milisegundo; referencia legible única por empresa, año y mes | unitario + propiedad |
| P-14 | Hash de documento sobre los bytes; llave semántica normalizada (mayúsculas, espacios, acentos, guiones) estable ante variaciones de formato | unitario + propiedad |

### Motor

| Id | Verifica | Tipo |
|---|---|---|
| P-20 | Matriz de fronteras por regla (sección 4): cada caso produce el hallazgo esperado o ninguno | unitario |
| P-21 | Registro de reglas: una política que nombra una regla inexistente se rechaza; una regla del código sin entrada en la política por defecto hace fallar el test | unitario |
| P-22 | Orden de severidad: con hallazgos mezclados, cualquier `frenar` gana; si no, `escalar`; `pagar` solo sin hallazgos | propiedad |
| P-23 | Invariante 1: `pagar` implica cero hallazgos con `on_fail` | propiedad |
| P-24 | Invariante 2: cualquier bandera proveniente de la extracción solo puede endurecer; `evaluate` con banderas extra nunca devuelve un veredicto más permisivo que sin ellas | propiedad |
| P-25 | Invariante 3: no existe camino en código de `escalar` a `pagar` sin una aprobación con persona; se prueba que `approveDecision` es la única función que lo hace y exige identidad | pipeline |
| P-26 | Invariante 4: `frenar` no cambia desde la pantalla; `approveDecision` sobre una `frenar` lanza | pipeline |
| P-27 | Invariante 5: el presupuesto se descuenta con `pagar` y con aprobación; nunca con `frenar` ni con `escalar` pendiente | propiedad + base |
| P-28 | Invariante 6: toda decisión lleva versión de política y hash; una decisión sin alguno no se persiste | base |
| P-29 | Invariante 7: reproducibilidad; `evaluate` llamada dos veces con las mismas entradas devuelve el mismo resultado, incluido el orden de hallazgos; el replay sobre el historial con la misma política reproduce cada veredicto | propiedad + regresión |
| P-30 | Invariante 8: la firma de aprobación cubre hash, monto, beneficiario, cuenta y versión; cambiar cualquiera invalida; una firma consumida no se acepta dos veces | unitario + base |
| P-31 | Invariante 9: con `payments_enabled` falso, ninguna entrada produce `pagar` y las que lo harían llevan `payments_disabled` | propiedad |
| P-32 | Invariante 10: la orden de pago toma cuenta y titular del vendor resuelto; si el texto extraído trae otra cuenta, la orden no la contiene | pipeline |
| P-33 | Invariante 11: extracción nula, política ausente, ledger ausente, error en una regla: el veredicto es `frenar` o `escalar`, nunca `pagar` ni excepción sin capturar | propiedad |
| P-34 | Explicador: toda regla del registro tiene plantilla; el texto contiene valor observado y umbral; test que falla si se agrega una regla sin plantilla | unitario |
| P-35 | Explicador: contenido del documento con `<`, `>`, `&`, markdown y URLs aparece escapado y nunca como enlace o etiqueta | unitario, `@seguridad` |

### Base, libro mayor y concurrencia

| Id | Verifica | Tipo |
|---|---|---|
| P-40 | Migraciones corren de cero en archivo local y en una base Turso de prueba; esquema resultante coincide con drizzle | base |
| P-41 | Toda tabla tiene columna de organización; una consulta de repositorio sin filtro de organización falla en test (envoltorio que lo exige) | base |
| P-42 | Tablas append-only: `UPDATE` y `DELETE` sobre política, decisiones, aprobaciones y eventos fallan por trigger | base |
| P-43 | Reserva de presupuesto: N reservas concurrentes contra un límite L comprometen como máximo L; las que no caben reciben `budget_exceeded` | base + propiedad |
| P-44 | Dos o más aprobaciones simultáneas de la misma escalada: exactamente una gana, las otras reciben "ya resuelta", el ledger y el saldo se descuentan una vez | pipeline |
| P-45 | Aprobación con monto, hash, cuenta o versión distintos a los firmados: rechazada en servidor aunque el cliente la envíe bien formada; una firma con otro secreto tampoco vale; si la cuenta registrada o la política cambian después de revisar, la firma vieja ya no vale; checklist incompleto o aprobador fuera de la lista: rechazada; el mismo cobro ya pagado en otra factura o presupuesto insuficiente: no se escribe nada | pipeline, `@seguridad` |
| P-46 | Idempotencia por entrega: la misma llave de recepción dos veces (incluso a la vez) crea una sola factura y una sola lectura; el mismo archivo por otra entrega crea otra factura que se frena con `duplicate_invoice` sin volver a llamar al modelo; la misma llave semántica con otro archivo también produce `duplicate_invoice`, incluso si los dos archivos se procesan a la vez; una llave mal formada se rechaza sin guardar nada | base + pipeline |
| P-47 | Transiciones: solo las permitidas (`recibida → procesando → decidida | esperando_aprobacion → aprobada | rechazada`, con `fallida` y reintento); una transición desde un estado viejo falla por comparación y cambio | base |

### Dataset e ingesta

| Id | Verifica | Tipo |
|---|---|---|
| P-50 | Manifiesto valida con zod; cada factura tiene decisión esperada, regla esperada y motivo; ninguna factura normal comparte llave semántica con otra salvo los duplicados declarados; procesado en orden contra el motor (Lector ideal, Verificador, Detector, Resolutor, política de fábrica, saldo y presupuesto descontados tras cada pago) cada caso da su veredicto y la regla que lo decide es la esperada, con cero falsos pagar y una sola factura en saldo insuficiente | unitario |
| P-51 | `npm run dataset` es determinista: dos corridas producen los mismos hashes; cada campo del manifiesto aparece literalmente en el texto del PDF generado | unitario |
| P-52 | Ingesta de PDF con capa: texto por página no vacío, PNG por página, hash del archivo y llave de almacenamiento sin nombre del cliente (las coordenadas de cada cita existen solo para el dataset generado; para documentos ajenos la cita se muestra como texto con su página) | pipeline |
| P-53 | Ingesta de PDF escaneado: texto vacío, PNG presente, la factura se marca para visión | pipeline |
| P-54 | Tipo por contenido: un `.pdf` que es ejecutable, un PNG con extensión `.pdf`, un archivo vacío: rechazados con error tipado | pipeline, `@seguridad` |
| P-55 | Límites: archivo mayor al tope y PDF con más páginas que el tope se rechazan con error tipado que dice qué hacer | pipeline, `@seguridad` |
| P-56 | Correo y chat: remitente, fecha y cuerpo se conservan como metadatos; el adjunto pasa por la misma ingesta | pipeline |

### Modelo, verificación, resolución y detección

| Id | Verifica | Tipo |
|---|---|---|
| P-60 | La salida del modelo se valida con zod estricto; una salida con campo extra, tipo incorrecto o JSON roto dispara un reintento y, si repite, `extraction_unreadable` | unitario con cliente simulado |
| P-61 | Exactamente un reintento; nunca dos | unitario |
| P-62 | Caché: segunda llamada con el mismo hash de documento, versión de prompt, esquema, modelo y hash del prompt construido no toca el cliente; cambiar cualquiera sí, incluido el cuerpo del correo que acompaña al mismo PDF; una lectura con canario filtrado no se cachea | unitario |
| P-63 | `llm_calls`: cada llamada registra modelo, versión de prompt, hash de prompt, tokens, costo, latencia y salida cruda; el costo calculado coincide con los precios configurados | unitario |
| P-64 | El prompt nunca contiene nombres de vendors, cuentas ni saldos; test que inspecciona el prompt construido | unitario, `@seguridad` |
| P-65 | Fixtures: las salidas grabadas cubren todo el dataset; una petición sin fixture hace fallar `npm run eval` sin `EVAL_LIVE`; el canario se graba como marcador y se repone al reproducir, así una fuga grabada se sigue detectando | regresión |
| P-66 | Verificador: una cita que no está en el texto produce `evidence_missing`; una cita con espacios o saltos distintos pero mismo contenido normalizado pasa | unitario |
| P-67 | Verificador: valor normalizado distinto del que se deriva de la cita produce hallazgo; monto en letras distinto del numérico produce `field_ambiguous` | unitario |
| P-68 | Totales: subtotal más impuestos distinto del total fuera de tolerancia produce `totals_mismatch` | unitario |
| P-69 | Respaldo: se invoca una sola vez y solo tras lectura ilegible o fallo del verificador en citas, valores o totales; "no es factura" no se repasa; el respaldo solo endurece (si dice que no es factura gana esa lectura; si discrepa en un campo crítico queda una ambigüedad); si también falla, se continúa con hallazgos; se registra como llamada separada con su costo; un plazo global por factura acota cada intento y, si no queda tiempo, no hay segunda pasada | unitario |
| P-70 | Resolutor: normalización de razón social (S.A.S., SAS, S.A.S, mayúsculas, tildes, puntuación) resuelve al mismo vendor | unitario + propiedad |
| P-71 | Resolutor: nombre parecido pero distinto resuelve desconocido con el vendor más cercano y su similitud; nombre nuevo resuelve desconocido sin cercano; ambos producen `payee_not_allowed` con el detalle | unitario |
| P-72 | Resolutor: cuenta distinta a la registrada produce `bank_account_mismatch`; titular distinto produce `account_holder_mismatch`; coincidencia por identificador fiscal gana sobre nombre | unitario |
| P-73 | Resolutor: nunca devuelve una cuenta que no esté en la lista de vendors | propiedad, `@seguridad` |
| P-74 | Detector: cada caso adversarial del dataset produce `suspicious_instructions`; ninguna factura normal lo produce | regresión, `@seguridad` |
| P-75 | Canario: una salida del modelo que contiene el token canario produce `suspicious_instructions` y se registra | unitario, `@seguridad` |

### Caso de uso completo

| Id | Verifica | Tipo |
|---|---|---|
| P-80 | Con modelo simulado detrás del Lector real, cada factura del manifiesto procesada en orden sobre una base sembrada con el historial termina en la decisión y regla esperadas, con versión y hash de política; cero falsos `pagar`; presupuesto y saldos se mueven exactamente por lo pagado | pipeline |
| P-81 | La decisión, sus hallazgos, la reserva y el evento se escriben en una transacción: si falla la reserva, no queda decisión de pago; dos facturas simultáneas que no caben juntas en el presupuesto terminan en un `pagar` y un `frenar` por `budget_exceeded`; si la política cambia mientras la factura se lee (por ejemplo, se apagan los pagos), la decisión usa la nueva | base + pipeline |
| P-82 | Error en cualquier etapa (normalización, lectura, resolución, evaluación, registro): la factura queda `escalar` con el hallazgo `processing_error` y su evento; nunca `pagar`, nunca estado intermedio; si ni eso se puede escribir, queda `fallida` con su evento, y reenviar la misma entrega la reintenta; una factura abandonada en `procesando` vence y se retoma. Un error del modelo deja la lectura ilegible (`extraction_unreadable`); una regla que lanza frena con `rule_error`, que es más estricto. Una entrega vacía o de tipo no soportado se rechaza sin registrar factura | pipeline |
| P-83 | Fecha programada: factura con vencimiento dentro de la ventana se programa; vencida fuera del atraso máximo escala; cálculo sobre fecha de calendario en la zona configurada | unitario |
| P-84 | Orden de pago: solo existe si el veredicto es `pagar`; está marcada "preparada, no ejecutada" y sus datos salen del vendor registrado; con `dry_run` la decisión se registra sin orden y sin comprometer presupuesto ni saldo, y queda como pago simulado en el historial: no cuenta como pago previo en modo real | pipeline |
| P-85 | Nivel `recomendar`: ninguna factura recibe `pagar`; todas las que lo harían quedan `escalar` con `autonomy_recomendar`. Con los pagos apagados, igual con `payments_disabled` | pipeline |
| P-86 | Eventos: toda transición escribe un evento con quién, cuándo y qué, con un mismo id de traza por factura; la bitácora reconstruye el estado final de cada factura; cada decisión encola un aviso | base |
| P-87 | Notificaciones: cada decisión encola un aviso en pantalla (y por Telegram si llegó por ahí); una fallida se reintenta con espera creciente (1, 2, 4, 8 minutos) y no antes; dos entregas a la vez no mandan el mismo aviso dos veces; tras cinco intentos queda fallida, con su evento, y visible en salud | pipeline |
| P-88 | Bandeja simulada: cada correo se procesa una vez aunque se lea dos veces o llegue también por "Procesar periodo" (la llave sale del Message-ID); un correo sin adjunto ni cuerpo de factura produce `extraction_unreadable` sin llamar al modelo | pipeline |

### Regresión y métricas

| Id | Verifica | Tipo |
|---|---|---|
| P-90 | `npm run eval` imprime autonomía (total y por grupo), falsos "pagar", regla esperada, tasa de escalado (total y sobre normales), explicabilidad, exactitud por campo, matriz de confusión, costo total y por factura, latencia media y máxima, y el resultado de la puerta | regresión |
| P-91 | Las métricas calculadas por `eval` coinciden con las que muestra la pantalla de métricas sobre la misma base: autonomía, falsos "pagar", regla esperada, escalado, explicabilidad, exactitud por campo, matriz de confusión y grupos. Se mide la decisión del agente al recibir la factura: una persona que reevalúa o aprueba después no cambia la autonomía | pipeline |
| P-92 | Umbrales (`src/eval/gate.ts`): falsos "pagar" = 0; exactitud de beneficiario, monto, moneda y número ≥ 99 por ciento; escalado sobre normales ≤ el valor calibrado en el paso 18 (cero con el Lector ideal); ninguna normal frenada; explicabilidad al 100 por ciento; un campo crítico sin medir cuenta como falla | regresión |
| P-93 | Puerta de CI: un cambio que relaja una regla, o una fixture rota o ausente, pone `npm run eval` en rojo. Bajar un umbral de confianza se prueba en el paso 18, sobre las lecturas reales del modelo | regresión |

### Interfaz

| Id | Verifica | Tipo |
|---|---|---|
| P-100 | Página de componentes: los nueve renderizan; contraste 4.5:1 en texto y 3:1 en chips, puntos y bordes de controles, calculado sobre los tokens de `globals.css`; foco visible al navegar con teclado; sin errores de consola | unitario (tokens y render en servidor) + e2e |
| P-101 | Pendientes muestra exactamente las escaladas del dataset ordenadas por vencimiento, las frenadas y las pagadas del día, sin el historial; el contador de la barra sale de la misma lectura; otra empresa no ve nada | pipeline + e2e |
| P-102 | Detalle: seleccionar un campo resalta la cita en imagen y texto; las posiciones salen de PDFium al ingerir y caen dentro de la casilla del campo en todas las plantillas del dataset; un valor repetido se ubica dentro de su cita; las reglas falladas aparecen primero con valor y umbral; la imagen de la página se sirve solo a su empresa, nunca el PDF | pipeline + e2e |
| P-103 | Aprobación: el botón está inactivo hasta marcar todo el checklist y elegir aprobador; aprobar crea una decisión `pagar` con la persona y la hora, con orden desde el vendor, y la factura desaparece de pendientes; un beneficiario fuera de la lista solo se rechaza; rechazar exige motivo y es final | pipeline + e2e |
| P-104 | Subida: archivo inválido muestra error con causa, sin exponer el esquema interno; válido aparece en la tabla con estado y luego veredicto; la lista filtra por veredicto, estado, canal y texto; las escrituras de otro origen reciben 403; los topes del día por visitante y global responden 429 con mensaje claro | pipeline + e2e |
| P-105 | Procesar periodo: todas las facturas del dataset cambian de estado en vivo y el total de tiempo es menor a tres minutos; el lote es exactamente el dataset en orden y el servidor solo acepta casos de esa lista, nunca una ruta; las rutas que leen con el modelo duran más que el plazo global de lectura | pipeline + e2e |
| P-106 | Reglas: editar el formulario actualiza el YAML y viceversa; un YAML roto desactiva el formulario con aviso; claves protegidas y controles no se cambian desde el YAML; solo firma un aprobador de la lista; guardar crea versión nueva con firma; un interruptor crea su versión y su evento sin tocar el resto | pipeline + e2e |
| P-107 | Replay: cambiar el umbral muestra el diff exacto de decisiones que cambiarían, sin escribir nada y acumulando el presupuesto que consumen los pagos nuevos; guardar cambia exactamente lo anunciado, nunca toca las pagadas, y la bitácora lo registra | pipeline + e2e |
| P-108 | Métricas: cada tarjeta y cada barra enlaza a las facturas que la componen y el conteo coincide; cada factura de una barra de regla tiene esa regla en su decisión vigente; lo pagado por moneda más lo comprometido antes suma lo comprometido del periodo | pipeline + e2e |
| P-109 | Bitácora: cada transición del pipeline aparece como evento de su factura; filtra por tipo, por factura (referencia o id) y por persona o el agente; cada evento enlaza a su factura; la factura de otra empresa no se encuentra | pipeline + e2e |
| P-110 | Escape: una factura cuyo nombre de beneficiario es `<img src=x onerror=alert(1)>` se muestra como texto literal en pendientes, detalle, explicación y notificación | e2e, `@seguridad` |
| P-112 | Corrección: los campos corregidos quedan con origen humano y el motor reevalúa con la política vigente; un valor inválido, un obligatorio vacío o un aprobador fuera de la lista se rechazan; lo que pagaría escala con `human_correction` y quien corrigió no puede aprobarlo, otra persona sí (propiedad: una corrección nunca vuelve más permisivo el veredicto); reevaluar con una política nueva puede pagar, pero nunca ablanda: una instrucción que venía en el cuerpo del correo sigue frenando; una factura pagada no se reevalúa | pipeline + propiedad, `@seguridad` |
| P-111 | Orden de pago PDF: se genera con los datos del vendor registrado, nunca con el texto leído; trae monto, referencia, versión y hash de la política, huella de la orden y QR con esa huella; es determinista; no existe para escaladas, pruebas sin orden ni facturas de otra empresa; abrirla no requiere el PDF original | pipeline + API |

### Operación, producción y canales

| Id | Verifica | Tipo |
|---|---|---|
| P-120 | `/api/health`: verde con todo en orden; rojo (503) si falta la política, falla la base o el proveedor (sin clave o con la última llamada fallida hace menos de media hora); ámbar con escaladas vencidas o avisos sin entregar; incluye antigüedad del pendiente más viejo; una consulta sin cookie no siembra una empresa; la pantalla de Salud y la barra lateral dicen lo mismo | pipeline + API |
| P-121 | Empresa por visitante: dos clientes sin cookie reciben empresas distintas; un cliente con cookie recibe siempre la misma; una cookie alterada se rechaza y se emite una nueva | API, `@seguridad` |
| P-122 | Aislamiento: una petición con cookie de la empresa A pidiendo una factura o archivo de la empresa B recibe 404 | API, `@seguridad` |
| P-123 | Topes: la factura N+1 del día para un visitante responde 429 con mensaje; el tope global igual; el dataset precargado sigue consultable | API |
| P-124 | `maxDuration`: una factura del dataset procesa de punta a punta en producción por debajo del límite configurado, medido en `llm_calls` y en la bitácora | manual con medición |
| P-125 | Archivos privados: la URL de un PNG o PDF no es adivinable ni pública; requiere la cookie de su empresa | API, `@seguridad` |
| P-126 | Reiniciar demo: solo afecta la empresa del visitante; la otra conserva su estado | API |
| P-127 | `/api/decide`: sin token o con token de otra empresa responde 401; con token válido responde el mismo veredicto que la pantalla para la misma factura | API |
| P-128 | `/api/decide`: petición mal formada responde 400 con detalle de zod; nunca 500 | API |
| P-129 | Telegram: el webhook rechaza peticiones sin el secreto; el mismo `update_id` dos veces procesa una vez | API, `@seguridad` |
| P-130 | Telegram: la respuesta escapa HTML del contenido del documento; un archivo que no es factura responde "no pude leerla" sin excepción | API, `@seguridad` |

## 4. Matriz de fronteras por regla (P-20)

Para cada regla, los casos mínimos. "=" es el valor igual al parámetro. Los parámetros de la política son obligatorios en el esquema, así que "parámetro ausente" no existe: cuando un dato de la factura o del vendor falta, la regla no aplica y lo registra con motivo. Los montos en otra moneda se comparan con la tasa fija sin redondear antes de comparar.

| Regla | Casos que no disparan | Casos que disparan |
|---|---|---|
| `payee_not_allowed` | vendor exacto; alias registrado; identificador fiscal coincide con nombre distinto | nombre parecido sin alias; vendor desconocido; vendor existente pero inactivo |
| `bank_account_mismatch` | cuenta igual con formato distinto (guiones, espacios); cuenta ausente en el documento (se paga a la registrada y queda registrado) | un dígito distinto |
| `account_holder_mismatch` | titular igual normalizado | titular distinto; titular ausente cuando la cuenta está presente |
| `vendor_not_verified` | vendor verificado por persona | vendor pendiente (un cambio de cuenta vuelve al vendor a pendiente; es responsabilidad del caso de uso que lo edita) |
| `vendor_velocity` | N−1 facturas en la ventana | N facturas; N+1; facturas justo fuera de la ventana no cuentan |
| `amount_over_hard_limit` | monto = límite −1; monto = límite | límite +1 (incluso un centavo de la moneda origen que al redondear parecería igual); tope absoluto del sistema aunque la política lo ponga más alto |
| `amount_over_approval_threshold` | umbral −1; = umbral | umbral +1 |
| `budget_exceeded` | comprometido + monto = límite | comprometido + monto = límite +1; ledger de otro periodo, otra moneda o ausente cuenta como ausente (`ledger_missing`, frenar); semana y mes usan su propia clave |
| `insufficient_balance` | saldo = monto | saldo = monto −1; saldo en otra moneda no cuenta |
| `duplicate_invoice` | mismo número, distinto vendor; mismo vendor, distinto número; igual pero fuera de la ventana | mismo archivo; misma llave semántica con otro archivo; misma llave con formato distinto del número |
| `amount_mismatch` | dentro de la tolerancia por arriba y por abajo; contratista con horas ≤ acordadas × tarifa; orden de compra que coincide; una sola orden abierta sin número en el documento | fuera de la tolerancia; contratista con más horas que las acordadas; orden que no está abierta; acuerdo ausente o varias órdenes abiertas sin número no disparan pero sí registran |
| `first_payment_to_vendor` | vendor con un pago previo | vendor sin pagos; vendor con pagos solo en estado rechazado |
| `amount_unusual_for_vendor` | dentro de la desviación; vendor con menos pagos previos que `min_history` (tres por defecto) no aplica | fuera de la desviación por arriba y por abajo |
| `unsupported_currency_or_rail` | moneda y riel en la lista | moneda fuera; riel fuera; combinación válida por separado pero no junta |
| `due_date_window` | vence dentro de la ventana; vence hoy; fecha ausente (se programa hoy y queda registrado) | vencida más del atraso máximo; vence más allá de la ventana (se programa, no dispara); fecha inexistente en el calendario produce `rule_error` y frena |
| `field_low_confidence` | confianza = mínimo; campo bajo que no está en `critical_fields` | mínimo −0.01 en un campo crítico; un solo campo bajo basta |
| `field_ambiguous` | un candidato | dos candidatos: dos totales en el documento, monto en letras distinto del numérico, o dos pasadas del modelo que leen distinto un campo crítico |
| `evidence_missing` | todas las citas presentes y cada valor derivado de su cita | una cita ausente o un valor que no se deriva de su cita (el Verificador guarda cuál de los dos) |
| `totals_mismatch` | subtotal + impuestos = total; sin desglose no aplica | diferencia mayor a una unidad mínima, la detecte el motor o el Verificador |
| `suspicious_instructions` | factura normal con la palabra "aprobado" en contexto normal | instrucción al sistema; "ya aprobado por el CFO"; texto oculto; token canario en la salida |
| `extraction_unreadable` | factura legible | no es factura; JSON inválido tras reintento; documento vacío |

## 5. Validaciones en los bordes

Toda entrada externa pasa por un esquema zod estricto antes de tocar lógica. La tabla fija qué se valida y qué pasa si falla.

| Borde | Qué se valida | Si falla |
|---|---|---|
| Subida de archivo | tamaño, tipo por contenido, páginas, nombre sin rutas | 400 con código y acción sugerida |
| Formulario de reglas | esquema de política completo, claves protegidas intactas, rangos (montos positivos, porcentajes 0 a 100, días enteros), referencia de reglas existentes | 400 con campo y motivo; nunca se guarda parcial |
| YAML de reglas | parser seguro sin tipos personalizados, mismo esquema que el formulario, tamaño máximo | igual que el formulario |
| Aprobación | identidad de la persona, decisión en estado `escalar`, firma sobre el contenido exacto, checklist completo con los ids esperados | 409 si el estado cambió; 400 si la firma no cubre; 403 si la persona no puede aprobar |
| Corrección de campo | campo existente, valor del tipo correcto, motivo no vacío | 400 |
| Salida del modelo | esquema estricto, tipos, enumeraciones, confianza entre 0 y 1, citas como cadenas | reintento único, luego `extraction_unreadable` |
| Variables de entorno | presencia, tipo, rangos | la app no arranca |
| `/api/decide` | token, cuerpo, archivo o referencia, tamaño | 401 o 400, nunca 500 |
| Webhook de Telegram | secreto, forma del update, `update_id` nuevo, tamaño del archivo | 401, 200 silencioso si repetido |
| Cookie de visitante | firma, expiración, empresa existente | nueva empresa y nueva cookie |
| Parámetros de consulta y paginación | enteros acotados, filtros de una lista cerrada | 400 |

## 6. Reglas de desarrollo que evitan errores de validación

Complementan `practicas.md` desde el punto de vista de pruebas.

1. **Tipos derivados de esquemas, nunca al revés.** `z.infer` es la única fuente de tipos de datos. Un tipo escrito a mano para datos externos no pasa revisión.
2. **Esquemas `.strict()` en todo borde.** Claves desconocidas son error, no ruido. Evita que un campo mal escrito pase en silencio.
3. **Errores tipados con código.** `YunqueError` con `code`, `severity`, `recoverable`, `action`. Las rutas convierten código a HTTP en un solo lugar. Ningún `catch` vacío.
4. **El reloj y el azar se inyectan.** `evaluate` recibe la fecha; los identificadores reciben el generador. Sin esto no hay reproducibilidad ni pruebas de fronteras de fecha.
5. **Toda escritura va por un caso de uso.** Las rutas y las acciones de servidor no tocan repositorios directamente. Así cada escritura tiene transacción, evento y prueba.
6. **Fixtures por hash, no por nombre.** El fixture del modelo se busca por hash de documento más versión de prompt; renombrar un archivo no reutiliza una salida vieja.
7. **Un test por bug.** Cada corrección trae el caso que la reproduce; va en la tabla de la regla o en el catálogo con su id.
8. **Los tests de seguridad se marcan.** Etiqueta `@seguridad` en la descripción; `npm run test:seguridad` los corre solos antes de desplegar.
9. **Nada se mockea en el motor.** Si una prueba del motor necesita un mock, el motor tiene una dependencia que no debería tener.
10. **Snapshot solo para explicaciones.** Texto de plantilla con snapshot revisado a mano; nunca snapshot de objetos de dominio.

## 7. Trampas conocidas

Cosas que ya sabemos que rompen proyectos como este. Cada una tiene la prueba o regla que la cubre.

| Trampa | Qué pasa | Cómo se evita |
|---|---|---|
| Flotantes en dinero | `0.1 + 0.2`, redondeos distintos en pantalla y en base | enteros de unidad mínima, P-10 |
| Conversión FX con redondeo inconsistente | el presupuesto se pasa por centavos según el orden de las sumas | una función de conversión, redondeo documentado, P-10 y P-43 |
| Zona horaria en vencimientos | una factura vence "hoy" en Bogotá y "ayer" en UTC | fechas de calendario para vencimientos, instantes UTC para eventos, P-83 |
| Caché de Next en rutas con datos | la pantalla muestra una decisión vieja | rutas dinámicas explícitas, sin caché de `fetch` para datos propios, P-101 |
| Acciones de servidor sin validar | el cliente manda un cuerpo manipulado | toda acción valida con zod y pasa por un caso de uso, sección 5 |
| Confiar en el estado que manda el cliente | aprobar una decisión que ya cambió | comparación y cambio sobre el estado en base, P-44 y P-47 |
| YAML con tipos personalizados | ejecución de código o tipos inesperados | parser seguro, esquema estricto, P-12 |
| Llave semántica sin normalizar | el duplicado con "F-2291" y "F 2291" pasa | normalización probada por propiedad, P-14 |
| Hash sobre el texto y no sobre los bytes | dos PDF distintos con el mismo texto se tratan como uno | hash sobre bytes para idempotencia, llave semántica aparte, P-14 y P-46 |
| Prompt sin versión | cambia el prompt y la caché devuelve salidas viejas | versión de prompt en la llave de caché y en `llm_calls`, P-62 |
| Modelo no determinista | el mismo documento sale distinto en cada corrida | temperatura cero, fixtures grabadas, verificación determinista, P-65 |
| WebAssembly no incluido en el despliegue | PDFium funciona en local y falla en Vercel | archivos del runtime incluidos explícitamente en el trazado de salida, P-124 |
| Node distinto en local y en Vercel | APIs que existen en 22 y no en 20 | `engines`, `.nvmrc` y versión fijada en Vercel, P-01 |
| Variables de entorno distintas en preview | el preview rompe por una variable ausente | mismas variables en los tres entornos, verificado por `loadConfig()` al arrancar, P-02 |
| SQLite ocupada bajo concurrencia | errores `busy` en el lote | transacciones cortas, modo WAL en local, lote de una factura por petición, P-43 |
| Transacciones en libSQL remoto | una transacción interactiva larga se corta | escrituras por lote dentro de una transacción corta, P-81 |
| Archivos públicos en el almacenamiento | cualquiera con la URL ve la factura | archivos privados servidos por nuestra ruta con cookie, P-125 |
| Cookie de visitante sin firma | un visitante adivina la empresa de otro | cookie firmada con `SESSION_SECRET`, P-121 y P-122 |
| Semilla por visitante en carrera | dos peticiones del mismo visitante crean dos empresas | creación idempotente por identificador de cookie, P-121 |
| Reintentos del modelo sin tope | un documento roto quema crédito | un reintento, un respaldo, P-61 y P-69 |
| Logs con contenido del documento | datos del documento en los logs de Vercel | el log registra ids y hashes; test que inspecciona la salida del logger, lista previa |
| Escapar en un sitio y olvidarlo en otro | inyección por notificación o por Telegram | el escape vive en el componente de texto y en el formateador de mensajes, P-35, P-110 y P-130 |
| ULID no monótono | eventos del mismo milisegundo se ordenan mal | generador monótono, P-13 |
| Renderizar demasiadas páginas | un PDF de 300 páginas agota la función | tope de páginas, P-55 |
| `maxDuration` por defecto | la función muere a mitad de la llamada al modelo | `maxDuration` explícito y medido, P-124 |

## 8. Puertas de calidad

| Puerta | Qué exige | Dónde |
|---|---|---|
| Commit | `npm run check` en verde | local, antes de cada commit |
| CI | `check`, `test:api`, `test:e2e` en verde | GitHub Actions |
| Despliegue | CI en verde, cero falsos "pagar" en `eval` | Vercel |
| Cambio de prompt, esquema o modelo | `EVAL_LIVE=1 npm run eval` corrido a mano, fixtures regrabadas y revisadas, costo por factura anotado | manual |
| Cambio en una regla | tabla de fronteras actualizada, invariantes en verde, explicación actualizada | revisión |
| Entrega | lista previa al pitch de `plan.md` sección 10 completa | manual |

## 9. Definición de terminado por paso

Un paso de `plan.md` está terminado cuando:

1. Sus pruebas referenciadas están en el catálogo y en verde.
2. `npm run check` está en verde.
3. No agregó dependencia nueva sin anotarla en `decisiones.md` si cambia una decisión.
4. Lo que muestra en pantalla existe como dato y como evento.
5. El commit tiene el nombre del paso y fue aprobado antes de subirse.
