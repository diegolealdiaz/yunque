# Prácticas de ingeniería de Yunque

> Reglas que gobiernan cómo se construye Yunque. Cada una dice qué se hace y por qué. Las marcadas **[demo]** entran en la versión del hackathon. Las marcadas **[después]** quedan diseñadas pero no se construyen hasta después del pitch.

## 1. El modelo

1. **El modelo extrae y redacta. Nunca decide.** [demo] La salida del modelo solo puebla campos de datos tipados. No existe un campo `action`, `recommendation` ni `instructions` que el motor lea. Si existe un campo `notes`, el motor no lo consume.
2. **El modelo no ve la lista de beneficiarios ni los saldos.** [demo] Un mismo paso no combina entrada no confiable (la factura), dato sensible (la lista) y acción consecuente (pagar). El modelo extrae nombre y cuenta "como aparecen"; el código los resuelve contra la lista.
3. **Nunca en bucle periódico.** [demo] El modelo se llama por evento: factura nueva. Vencimientos, recordatorios, conciliación y reintentos son código determinista.
4. **Haiku 5.5 por defecto; Sonnet 5.5 solo como segunda pasada.** [demo] La segunda pasada ocurre una sola vez por factura, cuando falla una verificación determinista. Su salida pasa por el mismo motor. Ambos modelos van en variables de entorno con alias (`MODEL_PRIMARY`, `MODEL_FALLBACK`).
5. **Tope de tokens de salida ajustado a la salida real.** [demo] Una extracción ocupa menos de 2.000 tokens. Sin tope, el proveedor reserva el máximo del modelo y con saldo bajo rechaza llamadas.
6. **Sin parámetros de razonamiento en extracción.** [demo] El esfuerzo mínimo del modelo. Cambiar modelo o esfuerzo exige correr el set de regresión completo.
7. **Validar el esquema en nuestro código, no en el modo estructurado del proveedor.** [demo] Un reintento como máximo, inyectando los campos inválidos con su ruta. Si falla otra vez, la factura escala. Nunca paga.
8. **Reintentos solo en 429 y 5xx, con plazo global por factura.** [demo] 401 y el resto de 4xx son terminales. Un pago nunca se reintenta automáticamente.
9. **Cache exacto por hash de documento más versión de prompt, esquema y modelo.** [demo] Nunca cache semántico: dos facturas casi iguales con montos distintos es el caso típico de fraude.
10. **Prompt estable arriba, documento abajo.** [demo] Sin fechas, IDs ni datos variables antes del documento. Así el prefijo cachea cuando el proveedor lo permite.
11. **Cada llamada al modelo queda registrada.** [demo] Tabla `llm_calls`: factura, modelo, versión del prompt, hash del prompt, salida cruda, intentos, tokens, costo y latencia. Es el dataset de regresión al cambiar modelo o prompt. El fallo al escribir el registro nunca afecta la llamada.
12. **Costo acumulado por paso y visible por factura.** [demo] La métrica "costo por factura decidida" aparece en la pantalla de métricas. Alerta de saldo del proveedor en dos umbrales. [después]
13. **Reservar antes de gastar.** [después] Estimar el costo en el peor caso, reservarlo en un ledger de costo por organización y liquidar con el uso real.

## 2. Extracción

14. **Esquema estricto y completo.** [demo] Todos los objetos con `.strict()`. Campos opcionales declarados como obligatorios y anulables: el modelo emite `null` explícito. Moneda y tipo de documento como enums. Identificadores fiscales y cuentas con patrón.
15. **"No es factura" es un resultado tipado, no un error.** [demo] Unión discriminada `invoice | not_invoice` con motivo y categoría. `not_invoice` lleva a frenar o escalar.
16. **Cada campo trae evidencia.** [demo] Para cada valor, la cita literal del documento de donde salió. El código verifica que la cita exista en el texto extraído y que el valor se derive de ella con parseo determinista. Un campo sin evidencia verificable no contribuye a pagar.
17. **Dos candidatos distintos para el mismo campo es ambigüedad.** [demo] Dos "Total" o dos cuentas distintas no se resuelven eligiendo uno. El campo queda ambiguo y la factura escala.
18. **El modelo devuelve la cadena literal y el valor normalizado.** [demo] El código re-parsea la cadena con reglas por locale (coma o punto decimal) y exige que coincida con el valor.
19. **PDF con texto se lee sin modelo.** [demo] El texto se extrae de forma determinista y se pasa junto con la imagen. Las citas se verifican contra ese texto. En imágenes y escaneados sin capa de texto la verificación es más débil: sube el umbral de escalamiento.
20. **La confianza del modelo solo baja decisiones.** [demo] Confianza baja en monto, moneda, beneficiario o fecha escala. Confianza alta no habilita nada por sí sola. El umbral se calibra sobre el set con decisión esperada: el corte que da cero falsos "pagar".
21. **Detector de suma.** [demo] Si hay subtotal e impuestos, deben sumar el total. Si no cuadra, escala.
22. **Todo contenido del documento es no confiable.** [demo] PDF, imagen, cuerpo y cabeceras del correo, remitente y chat entran al prompt etiquetados por fuente dentro de delimitadores, con la instrucción de tratarlos como datos. Eso es higiene, no control. El control es que el modelo no tiene poder.
23. **Detector de instrucciones embebidas como señal, no como defensa.** [demo] Patrones tipo "ignora las reglas", "ya aprobado por", "paga a esta cuenta" marcan `possible_injection` y frenan. Un token canario en el prompt que aparezca en cualquier campo extraído delata inyección: frenar y alertar.
24. **La pantalla nunca renderiza contenido extraído como HTML, markdown, imágenes ni enlaces.** [demo] Todo texto del documento se escapa. CSP estricto.

## 3. Motor de reglas y veredicto

25. **El veredicto es una función pura.** [demo] `evaluate(extraction, payeeMatch, policy, ledger) → { verdict, findings[] }`. Sin red, sin reloj implícito, sin modelo. Mismo input, mismo output, siempre.
26. **Pagar exige cero hallazgos de bloqueo.** [demo] Cada regla produce un hallazgo con `code`, `severity` (`block` o `warn`), valor observado, umbral y evidencia. Cualquier `block` impide pagar.
27. **Si falta un artefacto, se frena.** [demo] Lista de beneficiarios no cargada, política ausente, ledger inaccesible: el resultado es frenar. Nunca "pagar por defecto".
28. **Reglas como datos versionados.** [demo] Cada regla tiene identificador estable, categoría, parámetros, acción si falla (frenar o escalar) y versión. La versión de política se guarda en cada decisión. Las versiones son append-only.
29. **Claves protegidas.** [demo] Límite máximo absoluto, cuenta origen y lista de aprobadores no se editan desde el formulario. El prefijo protege también el bloque padre completo.
30. **Un tope global del sistema que la pantalla no puede desactivar.** [demo] Límite por pago, por periodo y por beneficiario son configurables. Encima de ellos hay un tope de sistema fijo en configuración de despliegue.
31. **Compuertas deterministas antes del modelo, asimétricas.** [demo] Duplicado por hash, beneficiario bloqueado, factura ya decidida: se resuelven sin modelo, con motivo registrado. Solo se descarta lo que se sabe con certeza. Lo dudoso pasa al pipeline completo.
32. **Revalidar justo antes de ejecutar.** [después] Cuando exista ejecución real, el motor corre de nuevo contra el estado fresco antes de cualquier efecto externo. Un pago aprobado hace días se reevalúa con la política vigente.
33. **Identificadores y cuentas nunca salen del texto del modelo.** [demo] El beneficiario y la cuenta destino de la orden de pago vienen de la lista de vendors. Si el modelo dice otra cosa, se registra y se ignora.

## 4. Dinero, estados y concurrencia

34. **Dinero en enteros de unidad mínima con moneda obligatoria.** [demo] Prohibido `number` flotante para montos. Una sola función de parseo y normalización. Comparaciones exactas; la tolerancia de "cuadra con lo acordado" se declara explícita en la regla.
35. **Máquina de estados cerrada.** [demo] `recibida → procesando → decidida (pagar o frenar) | esperando_aprobacion (escalar) → aprobada | rechazada`, más `fallida` con reintento y vuelta a `procesando` para corrección o replay. Cada transición se persiste antes de cualquier efecto externo. Ningún estado intermedio vive sin expiración. [después] Un estado explícito para lo no conciliable.
36. **Transiciones con compare-and-swap.** [demo] `UPDATE ... WHERE status = 'esperado'` y comprobar filas afectadas. Nunca leer, modificar y escribir.
37. **Reserva de presupuesto atómica.** [demo] Dentro de la misma transacción que inserta la decisión, un `UPDATE` condicional que solo escribe si cabe.
38. **Presupuesto consumido se calcula desde la tabla de decisiones, nunca desde contadores sueltos.** [demo] Dos contadores que deben moverse juntos se desincronizan.
39. **Clave de idempotencia por factura y restricción UNIQUE.** [demo] Derivada del contenido: hash del documento, y aparte la llave semántica (vendor, número, monto, moneda). Nunca del reloj.
40. **Cada decisión congela la versión de política y el hash del documento.** [demo] Una reevaluación es una decisión nueva que referencia a la anterior.
41. **Caches en memoria devuelven copias.** [demo] Nunca el objeto compartido.
42. **Datos acumulativos fallan en voz alta.** [demo] Un archivo o tabla de historial corrupto o inaccesible detiene el pipeline con alerta visible. Nunca se reinicia en silencio a vacío.

## 5. Aprobación humana

43. **La aprobación se verifica en el servidor.** [demo] Rol, sesión vigente y no autoaprobación. La pantalla solo refleja lo que el servidor decidió.
44. **La aprobación firma el contenido exacto.** [demo] Hash del documento, monto, beneficiario, cuenta y versión de política. Si algo cambia, la aprobación no vale. Una aprobación consumida no se reutiliza.
45. **Checklist, no botón.** [demo] El revisor marca casillas específicas antes de que se habilite "Aprobar": "verifiqué que la cuenta coincide con la registrada", "revisé la evidencia del monto". La pantalla muestra las citas resaltadas sobre el documento.
46. **La primera resolución gana.** [demo] Dos personas sobre la misma escalada: la segunda recibe "ya fue resuelta por X".
47. **Solo un humano convierte escalar en pagar.** [demo] Queda registrado quién, cuándo y con qué motivo. Las anulaciones de un bloqueo son append-only con `finding_code`, `reason`, `user_id`.
48. **La aprobación es una señal, no un bucle de espera.** [demo] El estado vive en la base. Una aprobación vieja se revalida contra la política vigente antes de cualquier efecto.

## 6. Operación y seguridad

49. **Kill switch externo.** [demo] Un flag `payments_enabled` en la base, consultado en cada decisión de pagar, no solo al arrancar. Se apaga sin desplegar.
50. **Circuit breaker.** [después] Si la tasa de "pagar" sube de golpe o aparecen N cambios de cuenta bancaria en una hora, todo pasa a escalar hasta revisión humana. Nunca se rearma solo.
51. **Modo dry-run por organización.** [demo] El agente decide y registra pero no produce órdenes ejecutables. El paso a ejecución real es explícito y visible. Los valores simulados nunca se filtran al modo real.
52. **Health con frescura.** [demo] `/api/health` verifica base, política cargada y proveedor del modelo, y reporta antigüedad del pendiente más viejo y conteo de escaladas. El latido se escribe después del trabajo, no antes.
53. **Fallar rápido sin defaults inseguros.** [demo] Variable de entorno ausente, clave del modelo ausente o política inválida: el sistema no arranca.
54. **Secretos nunca en el repo.** [demo] `.env*` ignorado desde el primer commit. Variables por entorno en Vercel. Lockfile commiteado y dependencias mínimas.
55. **Flags operativos en base o en entorno, nunca en código.** [demo] Mantenimiento, dry-run, modelo, umbrales.
56. **Alertas, no solo logs.** [después] Cola de notificaciones fallidas, saldo del proveedor, detectores que superan el 5 por ciento de las facturas del día.
57. **Demo pública acotada.** [demo] Tope de gasto en la clave del proveedor, tope de facturas por visitante y global por día, tamaño y tipo de archivo verificados por contenido, páginas renderizadas acotadas. Superado un tope, mensaje claro y el dataset precargado sigue funcionando.
58. **Una empresa por visitante en la demo.** [demo] Cookie firmada que apunta a una organización sembrada al primer acceso. Reiniciar demo solo afecta la propia. Ninguna ruta acepta un identificador de empresa desde el cliente sin verificarlo contra la cookie.
59. **Plan B ensayado, no supuesto.** [demo] El pitch se ensaya con la clave del modelo inválida: el dataset responde desde la caché por hash y la explicación por plantilla no depende del modelo. El video queda descargado en el equipo del pitch.
60. **Runtime fijado.** [demo] Node 22 en `engines` y en Vercel desde el scaffold, `maxDuration` por ruta que llame al modelo o renderice PDF. Base en UTC, pantalla en hora de Bogotá.

## 7. Registro, trazas y evaluación

61. **Registro de decisión inmutable y re-ejecutable.** [demo] Hash del documento, JSON extraído y su hash, modelo, versión de prompt y de esquema, versión de política, hallazgos con regla, valor, umbral y cita, veredicto, actor, costo, latencia, id de traza. Cualquiera puede recomputar el veredicto con esos datos.
62. **La explicación sale del motor.** [demo] Texto por plantilla a partir de los hallazgos, en español, con la cita del documento. Si el modelo redacta un resumen, solo reformula los hallazgos y no puede alterar el veredicto.
63. **Una traza por factura.** [demo] Span raíz con hijos `ingest`, `extract`, `validate`, `resolve_payee`, `evaluate`, `decide`, `notify`. Logs estructurados con id de petición y de factura. Contenido del documento fuera de los logs: referencias por hash.
64. **Set de evaluación con decisión esperada, separado de los ejemplos del prompt.** [demo] Cada factura del set lleva veredicto esperado y campos esperados. Métricas: exactitud por campo con normalización, tasa de evidencia verificable, matriz de confusión del veredicto, y **falsos "pagar", con tolerancia cero**.
65. **Cada guardarraíl tiene su caso de prueba.** [demo] Cada regla con su factura que la dispara. Set adversarial: texto blanco sobre blanco, "ya aprobado por el CFO" en el correo, monto en letras distinto del numérico, cuenta nueva para vendor conocido, instrucción embebida, duplicado en otro formato.
66. **Evaluadores programáticos para lo factual.** [demo] Comparación exacta o normalizada. Ningún modelo como juez de montos, beneficiarios ni veredictos.
67. **Umbrales decididos antes de medir.** [demo] Pasa: exactitud de monto y beneficiario mayor o igual al 99 por ciento y cero falsos "pagar". Falla: cualquier falso "pagar". Contra-métrica: tasa de escalado; si todo escala, el sistema no ahorra trabajo.
68. **Puerta de regresión en CI.** [demo] Cambiar prompt, esquema, modelo o reglas corre el set completo. Se bloquea con cualquier falso "pagar" o con caída de exactitud por campo. Los tests del motor y `tsc` estricto bloquean el despliegue.
69. **Detectores deterministas en producción.** [después] Suma que no cuadra, evidencia ausente, cuenta nueva, misma etiqueta en más del 5 por ciento de las facturas del día.

## 8. Sugerencias de mejora: el agente propone, finanzas decide

70. **Nada se autoaplica.** [después] Las sugerencias crean un borrador de versión de política. Una persona lo acepta o lo descarta. Si lo acepta, el replay muestra el efecto.
71. **Las sugerencias salen de reglas, no del modelo.** [después] Heurísticas deterministas sobre el historial: una regla que escaló N facturas y todas fueron aprobadas; un beneficiario nuevo aprobado tres veces. El modelo a lo sumo redacta el texto.
72. **Guardas acumulativas.** [después] Desviación máxima respecto al valor actual, claves protegidas intocables, hipótesis reversible, tope de cambios por semana y presupuesto de reversiones. Optimizar una métrica completa (trabajo ahorrado menos riesgo), no una parcial, porque una métrica parcial hace oscilar las reglas.
73. **Fila de auditoría por cada sugerencia.** [después] Propuesta, motivo, evidencia, quién la resolvió y cuándo.

## 9. Código y proceso

74. **Dominio puro en el centro, adaptadores en los bordes.** [demo] `src/domain` y `src/engine` sin dependencias de Next, base ni red. Un módulo por dependencia externa: solo `src/db` importa el driver, solo `src/extraction` importa el SDK del modelo.
75. **Una sola función de cálculo.** [demo] La pantalla muestra la salida del motor. Nunca recalcula montos, límites ni veredictos.
76. **TypeScript estricto.** [demo] Sin `any`, sin `as` para esquivar tipos, sin variables sin usar. Tipos derivados de zod. Errores tipados.
77. **Zod en todos los bordes.** [demo] Peticiones, salida del modelo, configuración, variables de entorno.
78. **Tests de tabla para cada regla con casos frontera.** [demo] Igual, mayor, mayor o igual. Invariantes: lo comprometido en el periodo nunca supera el límite; pagar implica cero bloqueos. [después] Mutation testing sobre `src/engine`.
79. **Trunk-based.** [demo] Una rama principal con previews por rama corta. Personalización por configuración en runtime, nunca por ramas.
80. **Commits pequeños y verificados.** [demo] Build y tests antes de cada commit. Un propósito por commit. Sin bloques de depuración ni `console.log` en código de producción.
81. **Build limpio en CI desde el primer commit de código.** [demo] `next build`, `tsc --noEmit`, lint y tests. Un push rojo no se despliega.
82. **Documentación generada desde la verdad.** [demo] El modelo activo, las reglas disponibles y las variables requeridas se listan desde la configuración y el código, no a mano. Un test comprueba que el README no nombre reglas inexistentes.
83. **Comentarios solo de "por qué".** [demo] Cada guarda o valor no obvio lleva una frase que cite el fallo que evita.
84. **Pantalla con errores accionables.** [demo] Cada error tiene código, severidad, si es recuperable y la acción sugerida. Timeouts del modelo con umbral de aviso.
