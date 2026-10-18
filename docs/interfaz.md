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

1. **La bandeja es la pantalla principal del producto, no un tablero de gráficos.** La persona entra a trabajar, no a mirar. Lo primero que ve es lo que requiere su decisión, ordenado por urgencia. Los gráficos viven en Métricas y se consultan cuando se quieren.
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
- **Facturas** es el archivo completo, con filtros por veredicto y búsqueda por beneficiario o referencia, y los botones "Procesar facturas de ejemplo" y "Subir factura".
- **Reglas** es la política vigente: formulario, YAML plegado, versiones.
- **Métricas** es para el gerente.
- **Bitácora** es el registro de eventos de todo el sistema, filtrable.
- El pie de la barra muestra el estado de los tres interruptores de control y la salud del sistema. Están ahí siempre porque son el argumento de seguridad del producto. Debajo va el selector de tema claro u oscuro.
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
- Las pagadas se colapsan en una línea. Abrirlas lleva a Facturas filtrada por veredicto y por "decididas hoy", así la lista tiene las mismas que cuenta la bandeja.
- En la demo, si hoy no llegó ninguna factura, la bandeja no dice solo "Nada pendiente": guía el primer paso, procesar las facturas de ejemplo en Facturas.

### 5.2 Detalle de decisión

El encabezado dice quién cobra; debajo, en una línea tenue, la referencia, cómo y hace cuánto llegó ("Llegó por correo hace 3 h") y cuándo vence. A la derecha, el monto en mono y el veredicto con su regla.

Después, la tarjeta **Por qué**: la decisión explicada para el cliente, sin códigos ni jerga. Un titular ("No se pagó.", "Necesita tu decisión.", "Se pagó dentro de tus reglas."), una frase por cada control que no pasó con los valores de esta factura ("Cobra distinto a lo acordado. La factura cobra 10.000.000 COP. Lo acordado con el beneficiario es 80 h × 95.000 COP."), cuántos controles pasó de los que aplican ("Pasó 13 de 14 controles.") y, en una columna a la derecha separada por una línea, **qué puedes hacer**. Lleva el color del veredicto en un tinte suave y en su borde. Sale de los mismos hallazgos registrados, de forma determinista; no cambia la decisión ni reemplaza el registro técnico. Al pie, "¿Fue clara la explicación?" con Sí y No; con No se abre un comentario opcional. La opinión queda en la bitácora y en la línea de tiempo, no cambia la decisión, y la más reciente es la que cuenta.

Debajo, tres tarjetas con una pregunta cada una, cada una con su título arriba.

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
- **Columna 2, Lo que leyó y revisó el agente.** Campos en filas con divisor: nombre, valor (en mono salvo el beneficiario) y confianza con un punto verde o, si está bajo el mínimo, un anillo ámbar; origen (modelo o persona). La fila del campo que hizo fallar un control lleva el tinte de lo que hace ese control. Controles: primero los que no pasaron, con su nombre en palabras y debajo, en mono tenue, valor observado, umbral y código; luego una línea "20 controles más: 13 pasaron, 7 no aplicaron" con "Ver todos", que los despliega. Al final, plegado, el **registro técnico** tal como quedó guardado, para auditoría.
- **Columna 3, Tu decisión.** Quién resuelve y el checklist específico para esta factura: las frases salen de las reglas que dispararon más las de severidad `warn`. Aprobar inactivo hasta completar; debajo, lo que se firma, en claro. "Rechazar" y "Corregir campo", lado a lado, abren cada uno su formulario en un diálogo: rechazar pide motivo; corregir abre los campos en edición con origen "persona" y reevalúa. Bajo una línea, la línea de tiempo con horas en mono.
- Si la decisión fue "pagar" o "frenar", la columna 3 muestra el estado, la orden preparada o el motivo del freno, y la opción "Reevaluar con la política actual" cuando hay una versión más nueva.
- En reevaluación, se muestra la decisión anterior en un bloque colapsado con la diferencia.

**Cuenta registrada al lado de la leída.** Bajo el campo "Cuenta", una línea dice si es la registrada del beneficiario ("Es la registrada de Stackline Cloud Inc.: ACH ****6789") o no, en rojo. Enmascarada: los números completos no se muestran.

**Instrucciones sospechosas, citadas.** El porqué cita el texto que las delató y dice de dónde salió: si no está en el documento, es del correo o chat que lo trajo ("La factura está bien, pero el correo que la acompaña dice «Ya aprobado por el CFO. Pagar hoy sin revisar…»"); si está en el documento, si era texto oculto. La cita se corta en palabras completas.

**Facturas del historial de ejemplo.** Las 24 facturas de julio a septiembre se ven como las del lote: su documento, pintado con la plantilla de su beneficiario, sus campos con la cita enmarcada y, la que no se pagó, su porqué (la de Stackline se frenó porque trae otra cuenta; la de Andes Hardware escaló por monto y la aprobó Ana Torres, con su evento). Como se decidieron antes de la demo, solo guardan el control que las decidió, y la pantalla lo dice en lugar de "Pasó X de Y controles".

### 5.3 Facturas

Encabezado con el título y, debajo, cuántas facturas hay ("57 facturas · todas las decisiones del agente y de tu equipo"). A la derecha los botones: en la demo, "Revisar correo de ejemplo (5)" y "Procesar facturas de ejemplo (33)", y "Subir factura", el primario, con su icono, que abre un diálogo. Arriba de la tabla, los veredictos en píldoras con cuántas hay en cada una (Todas, Pagadas, Escaladas, Frenadas, En proceso) y, a la derecha, la búsqueda por beneficiario o referencia (atajo `/`). Si se llega desde Pendientes, una píldora "Decididas hoy" muestra el filtro del día y lo quita con un clic. Estado y canal se aceptan en la dirección aunque la pantalla no los ofrezca.

"Probar con tu factura" (D23, D24) aparece solo si el correo real o Telegram están encendidos. Abre un diálogo: sin acceso, pide el código que tienen los clientes; con él, dice cuándo vence el acceso y muestra una sección por canal. "Por correo": la dirección personal con un botón "Copiar" y cuántos correos admite por día. "Por Telegram": el botón "Conectar Telegram", que abre el bot con un enlace de un solo uso, si el chat ya está conectado y cuántas facturas admite por día. Con un chat conectado, las facturas de ejemplo no se avisan una por una: al terminar el lote, el progreso dice "resumen enviado a Telegram". Yunque nunca responde ni reenvía correos. La factura que llega aparece en la lista por el canal Correo, y un correo que no se procesó (dirección vencida o tope alcanzado) queda en la Bitácora como "Correo no procesado", con el motivo.

Columnas, en una tarjeta con filas de 48 px: beneficiario con la referencia debajo en mono, monto con moneda, veredicto en una píldora pequeña (punto y palabra), motivo en pocas palabras (las pagadas dicen "Dentro de tus reglas"; el valor y el umbral, al pasar el ratón), canal en una palabra y actualizada ("hace 12 min", con la fecha exacta al pasar el ratón). Clic abre el detalle. Al procesar un periodo, las filas cambian de estado en vivo: "en cola", "leyendo", "decidida", y el chip de veredicto aparece una por una. Esta animación es la demostración de que el agente trabaja, y no necesita más adorno que eso.

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
┌ Cambios sin guardar.        Descartar  [ Ver qué cambiaría ]  [ Guardar como v5 ] ┐ (fija, con cambios)
```

- La pantalla cabe entera sin desplazarse, con el patrón de las páginas de configuración: pestañas en vez de una página larga, grupos en tarjetas con una frase de qué controlan y la barra de acciones fija abajo. La barra aparece solo cuando hay cambios sin guardar; sin cambios no tapa nada.
- El formulario habla en palabras de producto: sin códigos de regla (quedan en el YAML y al pasar el ratón) ni montos en centavos. Cada regla muestra sus dos salidas a la vista, Escalar o Frenar, con el color del veredicto.
- "Como código" es la misma política en YAML para auditarla o editarla entera; editar uno actualiza el otro. Una línea explica que ahí los montos van en centavos y las tolerancias en puntos básicos.
- "A quién se puede pagar" lista los beneficiarios registrados con una casilla cada uno, si están verificados y cuántos están permitidos. Es la lista `allowed_payees` de la política: marcar o desmarcar cambia el YAML como cualquier otro campo, y uno fuera de la lista sigue la regla «Beneficiario fuera de la lista».
- Arriba del formulario, una franja de resumen con el estilo del tablero de Métricas: en grande y en mono, hasta cuánto paga solo el agente (el umbral de aprobación) y, al lado, el límite por pago, el presupuesto, cuántos beneficiarios están permitidos y cuántas reglas vigilan cada factura. Lee el YAML que se edita, así cambia con cada campo.
- Los campos van rellenos, sin borde, con el valor en mono. Cada tarjeta lleva su título grande y una píldora con su cifra (8 ajustables, 8 de 8 permitidos, 13 fijas).
- "A quién se puede pagar" es una tabla sin desplazamiento propio: beneficiario, país, cuenta registrada (la ruta y los últimos cuatro dígitos: "ACH ****6789") y estado con su punto (verde verificado, ámbar sin verificar). Es donde se ve qué cuenta tiene registrada cada beneficiario.
- Debajo de las reglas configurables, "Siempre se aplican" agrupa las reglas fijas en "Frenan siempre" y "Escalan siempre", con un candado en el título. Lista las reglas con salida fija (cuenta o titular distinto, beneficiario sin verificar, límite por pago, umbral, saldo, moneda, las de lectura e instrucciones sospechosas), cada una con su frase, sin control. Están para que se vea que existen frenos que ninguna política ablanda.
- Las claves protegidas van en una línea con candado y sin edición.
- La pestaña "Tasas de cambio" muestra, de solo lectura, cuánto vale 1 USD en cada moneda y desde qué fecha (D22). No se editan aquí porque cambiarlas cambiaría qué se paga. El detalle de una factura en otra moneda dice con qué tasa se convirtió a USD para los límites.
- "Ver qué cambiaría" ejecuta el replay sobre el histórico y abre el resultado en un diálogo, desde el que se puede guardar. Es la pantalla que más convence a un cliente y vale la pena pulirla.
- Como la demo no tiene inicio de sesión, el aprobador que firma se elige en el encabezado. Sin elegirlo, los interruptores y el guardado quedan desactivados.
- Los interruptores de pagos, modo de prueba y el agente (decide o solo recomienda) están arriba, separados del formulario, porque no son política sino control. Cada uno es un interruptor con perilla que se desliza y un riel con el color de lo que significa su estado: pagos encendidos y el agente que decide en el azul de marca, pagos apagados en rojo, modo de prueba encendido en ámbar (no se paga de verdad); lo apagado sin consecuencia va en gris.

### 5.5 Métricas

Tres bloques, con el estilo de un tablero: cifras en mono, nombres en mayúsculas pequeñas, filas separadas por líneas.

- **Franja del periodo**, sin tarjeta: lo pagado en el periodo en grande, en el azul de marca, con cuántas facturas. Al lado, en dos columnas: lo frenado y lo escalado (en USD y cuántas facturas), cuántas esperan a una persona (con la más antigua) y lo que queda del presupuesto.
- **Cómo decide el agente**, en una tarjeta, medido sobre el lote con veredicto esperado: una píldora con cuántas facturas se midieron y los falsos "pagar" (en verde si son cero); cinco cifras en fila (autonomía, falsos "pagar", exactitud por campo, costo por factura, tiempo medio), y una tabla por tipo de caso: normales, trampas y adversariales, con qué prueba cada uno y cuántas acertó. Sin facturas medidas, la tarjeta lo dice y lleva a Facturas para procesar el lote.
- **Dos gráficos**: presupuesto del periodo (comprometido contra el límite, por moneda) y reglas que más dispararon.

Nada más. Cada número tiene un enlace a las facturas que lo componen, listadas abajo en la misma pantalla.

### 5.6 Bitácora

Con el estilo de tablero de Métricas: arriba, una tarjeta con cuántos eventos hay, cuántos son decisiones del agente y cuántos acciones de personas; debajo, una frase que dice qué es la bitácora (todo queda escrito, en orden, y nadie lo edita ni lo borra), y la tabla en una tarjeta con encabezados en mayúsculas pequeñas.

- Cada evento se dice para el cliente, en una frase y su porqué: "Frenó la factura · La cuenta de pago no es la registrada del beneficiario", "La pasó a una persona · Supera el monto que el agente paga solo", "Ana Torres · Aprobó el pago". Un punto con el color del veredicto (verde, rojo, ámbar; azul para firmas y cambios de reglas) deja ver de un vistazo qué pasó. Nada de códigos a la vista.
- Columnas: cuándo (hora en mono y fecha debajo), quién (iniciales en un círculo; el agente con el color de marca), qué pasó, y la factura con su beneficiario y su referencia. Clic abre la factura.
- Por defecto se ven "Decisiones y acciones"; "Todos los pasos" suma los pasos internos de cada factura (llegó, se preparó, se leyó). Filtros por factura, por quién y por tipo; todo en la URL.
- "Ver datos técnicos" muestra bajo cada evento su tipo y sus datos crudos tal como quedaron escritos: es la misma tabla de auditoría, sin transformación, para quien audita.

### 5.7 Salud

Página mínima: base, política cargada, proveedor del modelo, antigüedad del pendiente más viejo, escaladas abiertas, notificaciones fallidas. Verde o rojo por fila. Es lo que responde `/api/health`, en pantalla.

## 6. Sistema visual

| Elemento | Decisión |
|---|---|
| Tema | Claro y oscuro, con los mismos tokens. Sin elección guardada manda la del sistema; el selector al pie de la barra lateral la cambia y la guarda en el navegador. El tema se fija en `<html data-theme>` antes de pintar, así la página no parpadea. El oscuro usa el azul noche del fondo del logo; el claro, papel y tinta |
| Tipografía | Montserrat para toda la interfaz y JetBrains Mono para cifras: montos, referencias, conteos, horas e identificadores, alineados a la derecha en columnas de ancho fijo. Números tabulares en toda columna numérica |
| Tamaños | 13 px en tablas y formularios, 14 px en prosa, 18 px en títulos de sección, 26 a 30 px en títulos de pantalla y 64 px en la cifra principal. Las etiquetas de tabla y de grupo van en versalitas de 11 px con espaciado abierto. Jerarquía por escala y peso, no por color |
| Superficies | Tres niveles: barra lateral (`shell`), página (`paper`) y tarjeta (`surface`). El más oscuro enmarca, el más claro contiene. Las tarjetas llevan borde de un píxel, un brillo de 1 px arriba y una sombra corta en claro, más profunda en oscuro. La tarjeta se usa cuando agrupa algo de verdad; un dato suelto no necesita caja |
| Neutros | Claro: papel `#F8F7F3` y blanco con tinta azul-negra `#1A2233`. Oscuro: página `#0F1A2B`, tarjeta `#172438`, barra `#0A1220` y texto `#EEF3FA`. Grises derivados de la tinta, no grises puros |
| Semántica | Verde para pagar, ámbar para escalar, rojo para frenar, gris para en proceso. Siempre con icono y texto, nunca solo color. En oscuro van en su versión clara para mantener el contraste |
| Acento de marca | Uno solo: el azul acero del yunque (`#1E5EEB` en claro, `#4C8DFF` en oscuro). Marca dónde estás en la barra lateral y la acción principal de la pantalla, y nada más. Su degradado, del logo, aparece una vez por pantalla: en la cifra principal (Pendientes) o en el botón primario. Dos halos suaves del mismo azul arriba del fondo dan profundidad sin tocar el contenido. El logo se queda en su sitio: un yunque con la factura encima y las tres salidas (pagar, frenar, escalar), en el icono de la pestaña y junto al nombre en la barra lateral. Los archivos viven en `app/icon.png`, `app/apple-icon.png`, `public/marca.png` y `docs/marca/` |
| Botones | Un solo primario por pantalla, con el degradado de marca. Lo demás es secundario: borde y texto en tinta. Deshabilitado se sigue leyendo: borde y texto tenue, nunca invisible |
| Iconos | Un solo set de línea, 16 px, sin ilustraciones |
| Espaciado | Rejilla de 4 px. Tablas con filas de 44 px. Radios de 6 px en controles, 8 px en botones de navegación, 16 px en tarjetas y redondos en chips y píldoras |
| Movimiento | En el producto, solo transiciones de estado (fila que cambia de veredicto, contador que baja), sin animaciones de entrada. La única excepción es la portada: los controles de la tarjeta de ejemplo aparecen uno tras otro, como los revisa el agente. Con "reducir movimiento" del sistema, nada se anima |
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

- Contraste mínimo 4.5:1 en texto, 3:1 en chips, en los dos temas.
- Todo operable con teclado; foco visible. El detalle que se abre al pasar el ratón o con el foco (el del chip de veredicto) se cierra con Esc sin mover el ratón ni el foco.
- Semántica de color siempre acompañada de icono y texto.
- Estados de carga como esqueleto con la forma de cada pantalla (cifra y tabla en Pendientes, píldoras y tabla en Facturas, tarjeta "Por qué" y tres columnas en el detalle, tarjetas en Reglas y Métricas), no como rueda.
- Estado vacío con una frase que confirma lo que pasó y un enlace a verlo.
- Error de red: la fila mantiene su último estado y muestra "sin conexión, reintentando".

## 9. Lo que se construye en el hackathon y lo que no

| En el hackathon | Después |
|---|---|
| Pendientes, Detalle, Facturas, Reglas, Métricas, Salud, Bitácora mínima | Chat de consulta sobre decisiones |
| Replay "ver qué cambiaría" | Configuración guiada de primera vez en tres pasos (empresa y saldos, política, proveedores) |
| Teclado básico (J, K, Enter, Esc) | Paleta de comandos |
| Tema claro y oscuro | Temas por empresa |
| Español | Inglés |
| Una empresa | Selector de empresa activo |

## 10. Cómo se decide cualquier duda de interfaz

Cuando aparezca una duda que este documento no cubra, se responde en este orden:

1. ¿Muestra al agente decidiendo bajo reglas y a una persona mandando? Si no, no entra.
2. ¿Lo que se muestra existe como dato? Si no, primero el dato.
3. ¿Cabe en los nueve componentes? Si no, se justifica el décimo en `decisiones.md`.
4. ¿La persona de finanzas lo entiende sin que se lo expliquen? Si no, se reescribe la microcopia antes que el diseño.

## 11. Portada

La portada pública vive en `/` y presenta el producto a quien llega por el enlace; el producto empieza en `/pendientes`. La portada no lee ni crea empresas: la empresa de ejemplo nace solo al entrar al producto con "Probar la demo", así un rastreador que abre la portada no llena la base.

Se lee como un relato de venta, de arriba abajo: la promesa, la prueba, el problema, cómo se resuelve, el producto, por qué confiar y el cierre que repite la promesa.

1. **Aviso** sobre la barra: "Demo abierta", con cuántas facturas de ejemplo hay, y enlace a la demo.
2. **Barra fija** con el nombre, tres anclas (Cómo funciona, Control, Preguntas), el selector de tema y un solo botón: "Probar la demo". Arriba del todo es transparente; al bajar toma fondo y borde.
3. **Primer bloque, centrado.** Titular de velocidad con control ("Paga tus facturas sin salirte de tus reglas"), con el degradado de marca en la segunda mitad; una frase con las tres salidas; "Probar la demo" y "Ver cómo decide"; y la línea "Sin registro · datos de ejemplo · ningún pago real". Detrás, una rejilla fina y dos luces de marca.
4. **Portal.** Un marco de anillos con el azul de marca y, al fondo, el agente decidiendo en bucle tres facturas reales del lote: Nube Andina F-2291 se paga, Camila Rojas CR-121 se frena por instrucciones escondidas en el documento y Andes Hardware AH-5560 se escala por superar el umbral. Cada una con sus controles (valor contra umbral, en mono) y su veredicto, que es el que el motor les da.
5. **Cinta del lote**, de borde a borde: cada caso del lote de ejemplo con su veredicto y su motivo, y los totales por salida. Sale del manifiesto del dataset; si no se puede leer, la cinta no aparece.
6. **El problema,** en una frase grande y tres dolores cortos: todo pasa por las mismas manos, un PDF basta para desviar un pago, nadie puede mostrar por qué se pagó.
7. **Cómo funciona,** en tres pasos (llega, el agente la lee y la revisa, tú decides lo que importa), cada uno con su ilustración: los canales, los campos leídos con su confianza y los controles, y las tres salidas con los totales del lote y el checklist para aprobar.
8. **Dónde trabaja:** tres tarjetas lado a lado, PDF o foto (subida o lote), correo y Telegram, cada una con un ejemplo de su canal. El relato no favorece un canal: cada factura sigue el mismo camino llegue por donde llegue.
9. **El producto:** la bandeja de Pendientes en una ventana, con tres escaladas del lote.
10. **Por qué Yunque:** cuatro bloques de solo texto (rápido donde no hace falta criterio, explicable, seguro por diseño, tus reglas y tu firma) y el botón.
11. **Panel de control,** de borde a borde, con esquinas redondeadas y siempre en los tokens del tema oscuro (`.theme-dark`): las preguntas de quien controla los pagos se turnan en una píldora ("¿Quién aprobó este pago?", "¿Por qué se frenó esta factura?"…), y responde "Cada respuesta ya está escrita" con piezas del producto (bitácora que solo se agrega, ver qué cambiaría antes de guardar, interruptor, checklist, lo que Yunque nunca hace) y los datos: el cero de pagos indebidos en el set de regresión y las cifras que salen del código.
12. **Preguntas** frecuentes, cortas, que se abren en el sitio.
13. **Cierre** que repite la promesa del inicio, con el mismo botón, sobre un resplandor de marca.

**Movimiento** (GSAP, en `app/_landing/motion.tsx`; las secciones solo marcan qué se anima):

- **Entrada**, de unos 3 segundos: la barra baja, el titular sube línea por línea desde una máscara, luego el texto, los botones y el portal. Antes de hidratar, lo que la entrada muestra está oculto para que no parpadee; si la animación no arranca, se muestra solo a los 4 segundos.
- **Portal**, en escritorio: la sección queda fija y, al bajar, los anillos se abren hacia afuera mientras la escena crece desde el fondo del túnel hasta llenar la pantalla. El agente decide en bucle solo mientras se ve: una franja lee la factura, los controles aparecen uno tras otro, luego el veredicto, y una barra por factura marca el avance.
- **Al bajar**: el primer bloque se aleja; el problema se ilumina palabra por palabra; en "Cómo funciona" la ilustración queda fija y cambia con el paso que cruza el centro de la pantalla, unas pestañas fijas marcan ese paso y llevan a cualquiera, y una línea de avance se llena; el producto crece de 0,84 a 1; cada sección entra una vez con su titular por líneas y sus tarjetas escalonadas; las cifras cuentan hasta su valor y terminan en el texto exacto del servidor.
- **Cinta**: corre sola con CSS y se detiene bajo el puntero.
- **Bajo el puntero**: botones y enlaces crecen un poco con un resorte corto y vuelven más rápido y sin rebote; las tarjetas se levantan 4 px y una luz de marca sigue al puntero.
- **Menú del teléfono**: dos barras que se cruzan en una X moviendo sus puntas, un panel que entra desde la derecha con un resorte corto y filas escalonadas; sale hacia la derecha sin adornos. Esc cierra y devuelve el foco, Tab no sale del menú, la página no se desplaza detrás y al pasar a escritorio se cierra.
- Con "reducir movimiento" no se anima nada y todo está en su estado final, que es el mismo con o sin animación: el portal muestra la escena completa, el agente la primera factura decidida, la cinta queda quieta y se desplaza a mano, y "Cómo funciona" cambia de ilustración sin transición. En el teléfono no hay secciones fijas: cada paso trae su ilustración debajo. Se animan transform, opacidad y el recorte del portal.

Reglas de la portada: un solo botón primario, que siempre lleva al producto; ningún logo de clientes, testimonio ni cifra inventada; los casos que muestra son del lote de ejemplo y deciden como el motor los decide; nada que el código no haga hoy. Usa los mismos tokens, fuentes y componentes que el producto, en los dos temas.
