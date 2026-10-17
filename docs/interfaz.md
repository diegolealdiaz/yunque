# Interfaz de Yunque

Cómo se ve y cómo se usa Yunque. Este documento fija los principios, la navegación, cada pantalla y el sistema visual antes de escribir la primera línea de interfaz, para que el producto se sienta de una sola pieza y la persona de finanzas lo entienda sin manual.

## 1. Qué tiene que lograr la interfaz

La interfaz tiene tres públicos y una sola forma:

| Público | Qué necesita en los primeros diez segundos |
|---|---|
| Persona de finanzas | Qué hay que resolver hoy, y por qué el agente no lo resolvió solo |
| Cliente que evalúa Yunque | Ver al agente decidir, ver la regla que aplicó, ver que una persona manda |
| Quien integra Yunque | Que todo lo que ve en pantalla exista también como dato y como API |

De ahí salen los principios.

## 2. Principios

1. **La bandeja es la pantalla principal, no un tablero de gráficos.** La persona entra a trabajar, no a mirar. Lo primero que ve es lo que requiere su decisión, ordenado por urgencia. Los gráficos viven en Métricas y se consultan cuando se quieren.
2. **Cada veredicto lleva su regla al lado.** Nunca se muestra "escalada" sin el identificador de la regla, el valor observado y el umbral que la disparó. La explicación en prosa complementa, no sustituye.
3. **Excepciones primero.** Lo que el agente resolvió solo se ve en una línea y se puede abrir; lo que no pudo resolver ocupa el espacio. La pantalla se vacía cuando el trabajo se termina, y eso es una buena noticia visible.
4. **La evidencia está a un clic, nunca a una pestaña.** Documento y campos extraídos conviven en la misma vista. Seleccionar un campo lleva a la cita exacta en el documento.
5. **Aprobar es un acto, no un clic.** El botón se habilita cuando se marcó el checklist. El checklist nombra lo que la persona verificó. Lo que firma queda escrito.
6. **El color semántico se reserva para el veredicto.** Verde, ámbar y rojo significan pagar, escalar y frenar, y nada más. El resto de la interfaz es neutra para que esos tres colores griten cuando toca.
7. **Lenguaje de producto, no de banco.** "Pendientes", "Reglas", "Facturas", no "Módulo de cuentas por pagar". Verbos en infinitivo en botones, frases cortas en estados, cero jerga de IA en pantalla ("el agente leyó", no "el modelo infirió").
8. **Todo lo que se ve es dato.** Cada etiqueta, cada hallazgo y cada firma existe en una tabla y en la API. La interfaz no tiene lógica propia de decisión.
9. **Nada del documento se interpreta.** El contenido extraído se escapa siempre. Sin HTML, markdown, imágenes ni enlaces provenientes de la factura. Esto es un principio de interfaz tanto como de seguridad.
10. **Densidad de herramienta.** Una persona de finanzas procesa decenas de facturas; la interfaz usa tipografía de 13 a 14 píxeles, tablas compactas, números tabulares y navegación por teclado. No es una página de marketing.

## 3. Patrones adoptados y por qué

Son patrones que el mercado de cuentas por pagar y de pagos por agentes ya validó con usuarios reales. Los tomamos como base y los ajustamos a Yunque.

| Patrón | Qué resuelve | Cómo lo aplicamos |
|---|---|---|
| Bandeja agrupada por recomendación | La persona sabe qué hacer con cada grupo sin leer uno a uno | Tres secciones: "Esperan tu decisión", "Frenadas", "Pagadas por el agente" |
| Regla citada junto al veredicto | Confianza inmediata en la decisión | Chip de veredicto con la regla; al pasar el ratón, valor y umbral; en el detalle, la traza completa |
| Revisión con semáforo de confianza por campo y salto a la evidencia | Verificar campos en segundos sin leer el documento entero | Cada campo muestra confianza, cita literal y origen (modelo o persona); seleccionar el campo resalta la cita |
| Liberación de pago como paso separado de la aprobación | Separación de funciones | En Yunque la orden queda "preparada, no ejecutada"; la persona que aprueba y la que libera pueden ser distintas |
| Bitácora de actividad por documento | Auditoría sin preguntar a nadie | Línea de tiempo por factura: recibida, leída, verificada, decidida, aprobada, notificada, con quién y cuándo |
| Niveles de autonomía explícitos | Adopción gradual | Interruptor visible "Recomendar / Decidir" y los dos de emergencia: pagos habilitados y modo de prueba |
| Opinión sobre la explicación | Mejora continua con datos | Control "¿Fue clara la explicación?" en cada decisión |
| Estados vacíos que confirman | La pantalla vacía no asusta | "Nada pendiente. El agente resolvió 14 facturas hoy." con enlace a verlas |

Lo que el mercado hace y no copiamos:

- **Chat como interfaz principal.** Un chat esconde el estado y obliga a preguntar. Yunque muestra el estado. Un chat de consulta puede llegar después, nunca como puerta de entrada.
- **Pantalla única con todo (documento, chat, historial, campos, contabilidad).** Produce saturación. Yunque separa en tres columnas con una sola pregunta por columna: qué dice el documento, qué decidió el agente, qué hago yo.
- **Tablero de gráficos como inicio.** Las métricas importan al gerente, no a quien procesa. Van en su pantalla.
- **Asistente con nombre y avatar.** Personificar al agente invita a confiar por simpatía. Yunque se presenta como sistema con reglas, no como colega.

## 4. Navegación

Barra lateral fija, cinco destinos, en este orden de uso:

```
┌───────────────┬──────────────────────────────────────────────┐
│ Yunque        │                                              │
│               │  (contenido)                                 │
│ ● Pendientes 3│                                              │
│   Facturas    │                                              │
│   Reglas      │                                              │
│   Métricas    │                                              │
│   Bitácora    │                                              │
│               │                                              │
│ ─────────────  │                                              │
│ Pagos: ON     │                                              │
│ Agente: Decide│                                              │
│ Salud ●       │                                              │
│ Empresa demo ▾│                                              │
└───────────────┴──────────────────────────────────────────────┘
```

- **Pendientes** es el inicio. Muestra un contador cuando hay trabajo.
- **Facturas** es el archivo completo, con filtros por veredicto, canal, beneficiario y periodo, y el botón "Procesar facturas de ejemplo".
- **Reglas** es la política vigente: formulario, YAML plegado, versiones.
- **Métricas** es para el gerente.
- **Bitácora** es el registro de eventos de todo el sistema, filtrable.
- El pie de la barra muestra el estado de los tres interruptores de control y la salud del sistema. Están ahí siempre porque son el argumento de seguridad del producto.
- "Reiniciar demo" vivirá (paso 29) en el menú de la empresa, visible en modo demo, oculto en producción.
- El contenido se centra con un ancho máximo común a todas las pantallas, para que en un monitor grande no quede pegado a la izquierda. Los formularios (Reglas, Salud) son más angostos y se alinean al mismo borde izquierdo.
- Las tablas nunca se desplazan de lado en escritorio. Cada columna tiene prioridad: las secundarias (canal, actualizada, estado, referencia) se ocultan a medida que la pantalla se angosta, y el beneficiario recorta su texto. En el teléfono cada fila es una tarjeta: beneficiario arriba a la izquierda, monto arriba a la derecha y debajo el veredicto, el vencimiento y la referencia; toda la tarjeta abre la factura. En la Bitácora del teléfono no van los datos crudos.
- En escritorio ninguna pantalla mueve la página entera: las listas (Facturas, Bitácora) ocupan el alto que queda y se desplazan por dentro con el encabezado de la tabla fijo, así filtros y acciones siguen a la vista. "Subir factura" abre un diálogo desde el encabezado.
- Por debajo de 1024 px la barra lateral se pliega: arriba queda una barra con el nombre, el contador de pendientes y un botón "Menú" que la abre encima del contenido. Se cierra al navegar, con Esc o tocando fuera. Las tablas se desplazan de lado dentro de su tarjeta; la página nunca.

Teclado: `J` y `K` recorren filas, `Enter` abre, `Esc` vuelve, `/` busca, `G` seguido de `P`, `F`, `R`, `M` cambia de sección. Aprobar no tiene atajo a propósito.

## 5. Pantallas

### 5.1 Pendientes (inicio)

```
Pendientes                                   Hoy, 16 oct · 3 esperan tu decisión

ESPERAN TU DECISIÓN (3)
┌────┬──────────────────┬──────────────┬─────────┬──────────────────────────────┬──────────┐
│ ⚠  │ Nube Andina SAS  │ 4.800.000 COP│ vence 2d│ ESCALAR · cuenta no coincide │ Revisar →│
│ ⚠  │ Pedro Ruiz       │ 1.250,00 USD │ vence 5d│ ESCALAR · primer pago        │ Revisar →│
│ ⚠  │ Hostal Latam     │ 9.300,00 USD │ vence 1d│ ESCALAR · supera umbral      │ Revisar →│
└────┴──────────────────┴──────────────┴─────────┴──────────────────────────────┴──────────┘

FRENADAS (2)                                                     el agente las detuvo
  ⛔ Duplicada de FAC-0412 · Logística Sur ·  2.100.000 COP        ver
  ⛔ Instrucciones sospechosas en el documento · Diseño MX           ver

PAGADAS POR EL AGENTE HOY (14)                                   dentro de las reglas
  ✓ Ver las 14
```

- Las filas escaladas se ordenan por fecha de vencimiento, no por monto, porque lo urgente es lo que vence.
- El chip de veredicto incluye la regla en lenguaje corto. Al pasar el ratón: identificador, valor observado, umbral, versión de política.
- Las frenadas no piden acción; se muestran para que nadie se sorprenda y se pueden abrir.
- Las pagadas se colapsan en una línea. Abrirlas lleva a Facturas con el filtro aplicado.
- En la demo, si hoy no llegó ninguna factura, la bandeja no dice solo "Nada pendiente": guía el primer paso, procesar las facturas de ejemplo en Facturas.

### 5.2 Detalle de decisión

Arriba de todo, la tarjeta **Por qué**: la decisión explicada para el cliente, sin códigos ni jerga. Un titular ("No se pagó.", "Necesita tu decisión.", "Se pagó dentro de tus reglas."), una frase por cada control que no pasó con los valores de esta factura ("Cobra distinto a lo acordado. La factura cobra 10.000.000 COP. Lo acordado con el beneficiario es 80 h × 95.000 COP."), cuántos controles pasó y **qué puedes hacer**. Lleva el color del veredicto. Sale de los mismos hallazgos registrados, de forma determinista; no cambia la decisión ni reemplaza el registro técnico.

Debajo, tres columnas con una pregunta cada una.

```
← Pendientes      DEC-2026-10-0007 · Nube Andina SAS · 4.800.000 COP        ESCALAR

┌─ Documento ─────────────┬─ Lo que leyó y decidió ───────────────┬─ Tu decisión ─────────┐
│                         │ CAMPOS                                 │                       │
│  [imagen de la factura] │ Beneficiario  Nube Andina SAS   ● 0.98│ Para aprobar, marca:  │
│                         │ Cuenta        ****4471          ● 0.97│ ☐ Verifiqué que la    │
│  ░░░░░░░░░░░░░░░░░░░░░  │ Monto         4.800.000 COP     ● 0.99│   cuenta coincide con │
│  ░ "Cuenta de ahorros ░ │ Número        F-2291            ● 0.95│   la registrada       │
│  ░  Bancolombia 4471" ░ │ Vence         18 oct 2026       ● 0.91│ ☐ Revisé la evidencia │
│  ░░░░░░░░░░░░░░░░░░░░░  │                                        │   del monto           │
│                         │ REGLAS                                 │ ☐ Reconozco: primer   │
│  (cita resaltada al     │ ⛔ bank_account_mismatch               │   cambio de cuenta    │
│   seleccionar un campo) │    leída ****4471 · registrada ****9023│   en 14 meses         │
│                         │ ✓ payee_not_allowed                    │                       │
│                         │ ✓ amount_over_hard_limit  4.8M ≤ 20M   │ [ Aprobar ] (inactivo)│
│                         │ ✓ duplicate_invoice                    │ [ Rechazar… ]         │
│                         │ ✓ budget_exceeded  61% del periodo     │ [ Corregir campo… ]   │
│                         │ … 16 reglas más, todas en orden        │                       │
│                         │                                        │ Firma: doc 3f9a…,     │
│                         │ EXPLICACIÓN                            │ política v4, 4.8M COP │
│                         │ La cuenta de la factura no coincide    │ a ****4471            │
│                         │ con la registrada para este proveedor. │                       │
│                         │ Un cambio de cuenta requiere que una   │ LÍNEA DE TIEMPO       │
│                         │ persona lo confirme con el proveedor.  │ 09:12 recibida (buzón)│
│                         │ ¿Fue clara? 👍 👎                      │ 09:12 leída · 1,8 s   │
│                         │                                        │ 09:12 verificada      │
│                         │ Orden de pago: preparada, no ejecutada │ 09:12 escalada        │
│                         │ Costo de lectura: 0,0021 USD           │ 09:13 notificada      │
└─────────────────────────┴────────────────────────────────────────┴───────────────────────┘
```

- **Columna 1, Documento.** Imagen de cada página, renderizada en el servidor al ingerir, con las citas resaltadas encima cuando se conoce su posición. Debajo, el texto leído con las mismas citas resaltadas. Seleccionar un campo en la columna 2 desplaza y resalta su cita. El navegador nunca abre el PDF original ni renderiza contenido del documento como HTML.
- **Columna 2, Lo que leyó y revisó el agente.** Campos con confianza en punto de color más valor numérico al pasar el ratón, origen (modelo o persona, con quién y cuándo si fue corregido). Controles: primero los que no pasaron, con su nombre en palabras y debajo, tenue, valor observado, umbral y código; luego los que pasaron, colapsados. Al final, plegado, el **registro técnico** tal como quedó guardado, para auditoría.
- **Columna 3, Tu decisión.** Checklist específico para esta factura: las frases salen de las reglas que dispararon más las de severidad `warn`. Aprobar inactivo hasta completar. Rechazar pide motivo. Corregir campo abre el campo en edición con origen "persona" y reevalúa. Debajo, lo que se firma, en claro. Y la línea de tiempo con tiempos y canal.
- Si la decisión fue "pagar" o "frenar", la columna 3 muestra el estado, la orden preparada o el motivo del freno, y la opción "Reevaluar con la política actual" cuando hay una versión más nueva.
- En reevaluación, se muestra la decisión anterior en un bloque colapsado con la diferencia.

### 5.3 Facturas

Tabla densa con filtros arriba y los botones de acción en el encabezado: "Subir factura" (abre un diálogo) y, en la demo, "Procesar facturas de ejemplo (33)" y "Revisar correo de ejemplo (5)", con el número de casos y una línea que dice qué simulan.

"Probar con tu factura" (D23, D24) aparece solo si el correo real o Telegram están encendidos. Abre un diálogo: sin acceso, pide el código que tienen los clientes; con él, dice cuándo vence el acceso y muestra una sección por canal. "Por correo": la dirección personal con un botón "Copiar" y cuántos correos admite por día. "Por Telegram": el botón "Conectar Telegram", que abre el bot con un enlace de un solo uso, si el chat ya está conectado y cuántas facturas admite por día. Con un chat conectado, las facturas de ejemplo no se avisan una por una: al terminar el lote, el progreso dice "resumen enviado a Telegram". Yunque nunca responde ni reenvía correos. La factura que llega aparece en la lista por el canal Correo, y un correo que no se procesó (dirección vencida o tope alcanzado) queda en la Bitácora como "Correo no procesado", con el motivo.

Columnas: estado (punto de color y texto en tinta: ámbar espera a una persona, rojo falló o se rechazó, verde aprobada, gris en curso), referencia, beneficiario, monto con moneda, vence, canal, veredicto con regla, actualizada. Clic abre el detalle. Al procesar un periodo, las filas cambian de estado en vivo: "en cola", "leyendo", "decidida", y el chip de veredicto aparece una por una. Esta animación es la demostración de que el agente trabaja, y no necesita más adorno que eso.

### 5.4 Reglas

```
Reglas                       Demo sin inicio de sesión · Firmas como [ Ana Torres ▾ ] [Usar]
[ Pagos: Encendidos ]   [ Modo de prueba: Apagado ]   [ El agente: Decide ]

 Política │ Código │ Versiones │ Tasas                       Vigente: v4 · firmada por …
 🔒 Tope absoluto 100.000 USD · 🔒 Cuenta origen … · 🔒 Aprobadores …
┌─ Límites ─────────────────────────┐ ┌─ Si una regla no se cumple ────────────────┐
│ Límite por pago      [ 20.000 ] USD│ │ Factura duplicada          [Escalar|Frenar]│
│ Umbral de aprobación [  5.000 ] USD│ │ Primer pago a un benef.    [Escalar|Frenar]│
│ Presupuesto  [100.000] USD  mes ▾  │ │ …                                          │
├─ Parámetros ──────────────────────┤ └────────────────────────────────────────────┘
│ Tolerancia [5] % · Ventana [90] días…│
└───────────────────────────────────┘
┌ Cambios sin guardar.        Descartar  [ Ver qué cambiaría ]  [ Guardar como v5 ] ┐ (fija)
```

- La pantalla cabe entera sin desplazarse, con el patrón de las páginas de configuración: pestañas en vez de una página larga, grupos en tarjetas con una frase de qué controlan y la barra de acciones fija abajo.
- El formulario habla en palabras de producto: sin códigos de regla (quedan en el YAML y al pasar el ratón) ni montos en centavos. Cada regla muestra sus dos salidas a la vista, Escalar o Frenar, con el color del veredicto.
- "Como código" es la misma política en YAML para auditarla o editarla entera; editar uno actualiza el otro. Una línea explica que ahí los montos van en centavos y las tolerancias en puntos básicos.
- Las claves protegidas van en una línea con candado y sin edición.
- La pestaña "Tasas de cambio" muestra, de solo lectura, cuánto vale 1 USD en cada moneda y desde qué fecha (D22). No se editan aquí porque cambiarlas cambiaría qué se paga. El detalle de una factura en otra moneda dice con qué tasa se convirtió a USD para los límites.
- "Ver qué cambiaría" ejecuta el replay sobre el histórico y abre el resultado en un diálogo, desde el que se puede guardar. Es la pantalla que más convence a un cliente y vale la pena pulirla.
- Como la demo no tiene inicio de sesión, el aprobador que firma se elige en el encabezado. Sin elegirlo, los interruptores y el guardado quedan desactivados.
- Los interruptores de pagos, modo de prueba y el agente (decide o solo recomienda) están arriba, separados del formulario, porque no son política sino control.

### 5.5 Métricas

Seis tarjetas numéricas arriba y dos gráficos abajo. Las tarjetas: autonomía (decisiones correctas sin persona), falsos "pagar" (con el cero en grande), exactitud por campo, costo por factura, tiempo medio de decisión, pendientes más antiguos. Los gráficos: pagado por moneda contra presupuesto en el periodo, y reglas que más dispararon. Nada más. Cada número tiene un enlace a las facturas que lo componen.

### 5.6 Bitácora

Lista cronológica de eventos de dominio con filtro por tipo, factura y persona. Cada evento muestra quién, cuándo, qué, el detalle en palabras (la regla que decidió, el canal, el costo de lectura) y el enlace a la factura. Debajo del detalle, tenues, los datos crudos del evento, completos al pasar el ratón: es la misma tabla de auditoría, sin transformación.

### 5.7 Salud

Página mínima: base, política cargada, proveedor del modelo, antigüedad del pendiente más viejo, escaladas abiertas, notificaciones fallidas. Verde o rojo por fila. Es lo que responde `/api/health`, en pantalla.

## 6. Sistema visual

| Elemento | Decisión |
|---|---|
| Tema | Claro por defecto. Un producto que mueve dinero se lee con luz. Oscuro como opción, no como identidad. Mismo registro que la plataforma de pagos en la que se integra, con valores propios |
| Tipografía | Inter para toda la interfaz, Geist Mono para identificadores, hashes y montos en tablas. Números tabulares en toda columna numérica |
| Tamaños | 13 px en tablas y formularios, 14 px en prosa, 20 a 24 px en títulos. Sin tamaños decorativos |
| Neutros | Papel levemente cálido de fondo (`#F8F7F3` y blanco) con tinta azul-negra (`#1A2233`). Grises derivados de la tinta, no grises puros. Bordes de un píxel; sombras cortas solo en capas flotantes |
| Semántica | Verde para pagar, ámbar para escalar, rojo para frenar, gris para en proceso. Siempre con icono y texto, nunca solo color |
| Acento de marca | Ninguno. El botón primario y los enlaces son tinta. Los únicos colores cromáticos de la interfaz son los tres del veredicto: la interfaz es neutra, el color lo pone la decisión. Hay dos excepciones, y las dos quedan fuera del contenido. Un marco de luz azul suave en el borde de la ventana, con el degradado del logo, que no intercepta clics ni se imprime. Y el logo, que se queda en su sitio: un yunque con la factura encima y las tres salidas (pagar, frenar, escalar), en el icono de la pestaña y junto al nombre en la barra lateral, a 24 px. Los archivos viven en `app/icon.png`, `app/apple-icon.png`, `public/marca.png` y `docs/marca/` |
| Iconos | Un solo set de línea, 16 px, sin ilustraciones |
| Espaciado | Rejilla de 4 px. Tablas con filas de 36 px. Radios de 4 px en controles y 12 px en tarjetas |
| Movimiento | Solo transiciones de estado (fila que cambia de veredicto, contador que baja). Sin animaciones de entrada |
| Montos | Formato de la moneda con separadores locales y código ISO al final: `4.800.000 COP`, `1,250.00 USD`. Nunca símbolos ambiguos |
| Fechas | Relativas en listas ("vence en 2 días"), absolutas en detalle y bitácora |

Componentes base: tabla, chip de veredicto, punto de confianza, tarjeta numérica, checklist de aprobación, línea de tiempo, visor de documento con citas, editor de política doble, interruptor de control con confirmación. Son nueve componentes y cubren todas las pantallas. Se construyen una vez sobre primitivas accesibles y se reutilizan.

## 7. Microcopia

- Botones en infinitivo: "Aprobar", "Rechazar", "Corregir campo", "Subir factura".
- Veredictos en mayúscula sostenida corta: PAGAR, ESCALAR, FRENAR. En prosa: "pagada", "escalada", "frenada".
- El agente se nombra como "el agente" o "Yunque", nunca "la IA" ni "el modelo" en pantalla.
- Explicaciones en segunda persona cuando piden algo ("confirma la cuenta con el proveedor") y en tercera cuando informan ("la cuenta no coincide con la registrada").
- Errores con causa y salida: "No se pudo leer el documento. Está borroso o protegido. Súbelo de nuevo o escálalo a mano."
- Sin signos de exclamación, sin emojis fuera de la opinión sobre la explicación.

## 8. Accesibilidad y estados

- Contraste mínimo 4.5:1 en texto, 3:1 en chips.
- Todo operable con teclado; foco visible.
- Semántica de color siempre acompañada de icono y texto.
- Estados de carga como esqueleto de la tabla, no como rueda.
- Estado vacío con una frase que confirma lo que pasó y un enlace a verlo.
- Error de red: la fila mantiene su último estado y muestra "sin conexión, reintentando".

## 9. Lo que se construye en el hackathon y lo que no

| En el hackathon | Después |
|---|---|
| Pendientes, Detalle, Facturas, Reglas, Métricas, Salud, Bitácora mínima | Chat de consulta sobre decisiones |
| Replay "ver qué cambiaría" | Configuración guiada de primera vez en tres pasos (empresa y saldos, política, proveedores) |
| Teclado básico (J, K, Enter, Esc) | Paleta de comandos |
| Tema claro | Tema oscuro |
| Español | Inglés |
| Una empresa | Selector de empresa activo |

## 10. Cómo se decide cualquier duda de interfaz

Cuando aparezca una duda que este documento no cubra, se responde en este orden:

1. ¿Muestra al agente decidiendo bajo reglas y a una persona mandando? Si no, no entra.
2. ¿Lo que se muestra existe como dato? Si no, primero el dato.
3. ¿Cabe en los nueve componentes? Si no, se justifica el décimo en `decisiones.md`.
4. ¿La persona de finanzas lo entiende sin que se lo expliquen? Si no, se reescribe la microcopia antes que el diseño.
