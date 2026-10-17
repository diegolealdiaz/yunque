# Trazabilidad: reto contra arquitectura

> Cada exigencia del reto, dónde la cubre la arquitectura, y qué ajustes salieron de confrontarlas. Las alternativas consideradas están en `decisiones.md`.

## 1. Matriz de trazabilidad

| # | Exigencia del reto | Componente que la cubre | Estado |
|---|---|---|---|
| R1 | Leer una factura (PDF, imagen, correo, chat) y extraer a quién, cuánto, en qué moneda y para cuándo | Canales, Lector, Verificador | Cubierto. El ajuste A2 (fecha programada `scheduled_for` y regla `due_date_window`) ya está en `arquitectura.md` |
| R2 | Reglas configurables: límites por pago y por periodo, beneficiarios permitidos, aprobación humana por encima de cierto monto | Juez, política versionada, formulario | Cubierto. El ajuste A3 (periodo mes o semana) ya está en `arquitectura.md` |
| R3 | Registro de cada decisión: pagó, frenó o escaló, y por qué | Bitácora, hallazgos, Explicador | Cubierto |
| R4 | Casos trampa: cobro duplicado | Compuerta por hash y llave semántica, regla `duplicate_invoice` | Cubierto |
| R5 | Casos trampa: beneficiario nuevo fuera de la lista | Resolutor, regla `payee_not_allowed` | Cubierto |
| R6 | Casos trampa: factura que no cuadra con lo acordado | Vendor con acuerdo u orden de compra, regla `amount_mismatch` con tolerancia | Cubierto |
| R7 | Casos trampa: monto que supera el límite y necesita aprobación humana | Reglas `amount_over_hard_limit` (frenar) y `amount_over_approval_threshold` (escalar) | Cubierto |
| R8 | Casos trampa: saldo o presupuesto insuficiente para el periodo | Ledger de presupuesto, regla `budget_exceeded` | Cubierto tras el ajuste A1: saldo simulado por moneda en la empresa y regla `insufficient_balance`, distinta de `budget_exceeded`. Incorporado en `arquitectura.md` (dominio, reglas, pipeline, dataset) |
| R9 | Pantalla simple donde la empresa define sus reglas | Pantalla de reglas: formulario con vista YAML | Cubierto |
| R10 | Pantalla donde ve qué decidió pagar, qué frenó, qué dejó pendiente y por qué | Pantallas de facturas, detalle, pendientes | Cubierto |
| R11 | Ningún dato real de clientes ni empresas | Dataset generado, empresa ficticia | Cubierto |
| R12 | El agente nunca aprueba un pago fuera de las reglas sin aprobación humana | Juez determinista; invariante probada; solo humano convierte escalar en pagar | Cubierto |
| R13 | Cada decisión tiene que poder explicarse después | Decisión inmutable con hallazgos, evidencia y versión de política; re-ejecutable | Cubierto |
| R14 | Éxito: autonomía, qué tanto del set decide correctamente sin persona | Set con decisión esperada, pantalla de métricas | Cubierto. La métrica está definida en la sección 3 y en la pantalla de métricas de `arquitectura.md` |
| R15 | Éxito: seguridad, cero pagos aprobados fuera de reglas | Invariante en tests, set adversarial, puerta de CI con tolerancia cero | Cubierto |
| R16 | Éxito: explicabilidad, cualquiera entiende el registro sin abrir el código | Explicación por plantilla en español con cita del documento | Cubierto |
| R17 | El flujo termina en la decisión; no se mueve dinero ni se conecta a plataforma de pagos | Orden de pago como borrador en formato de Blinka | Cubierto. La etiqueta "preparada, no ejecutada" ya está en el pipeline y la pantalla de detalle de `arquitectura.md` |
| R18 | No entra: abrir cuentas, verificar identidad, fraude, cumplimiento, diseño de la app de Blinka | Fuera de alcance por diseño | Cubierto |
| R19 | Por qué importa: empresas que arman sus propios agentes y quieren que paguen; lo que falta es confianza | Motor determinista, explicabilidad | Planeado (ajuste A6): `POST /api/decide` sobre el mismo pipeline, paso 31 del plan. Todavía no existe |
| R20 | Entregable: agente funcionando sobre su set de facturas | Lote, canales, pantalla | Cubierto |
| R21 | Entregables del hackathon: repo público con README de flujos y arquitectura, video, demo en vivo | README por el marco de cuatro pasos, Vercel, video (pasos 33 y 34 del plan) | Cubierto |

## 2. Ajustes que salen de la matriz

| Ajuste | Qué cambia | Costo | Entra en |
|---|---|---|---|
| A1 Saldo simulado | La empresa tiene saldo por moneda (USD principal). Regla `insufficient_balance` distinta de `budget_exceeded`. El saldo baja con cada "pagar" y con cada aprobación | Bajo | Demo |
| A2 Fecha programada | "Pagar" produce `scheduled_for`: la fecha de vencimiento, o la fecha de hoy si ya venció, según la política `pay_days_before_due`. Regla `due_date_window`: vencida hace más de N días escala; pagar antes de M días no se programa | Bajo | Demo |
| A3 Periodo configurable | `budget.period: month \| week`. Mes por defecto | Bajo | Demo |
| A4 Métrica de autonomía definida | Ver sección 3 | Nulo | Demo |
| A5 Orden preparada, no ejecutada | Etiqueta explícita en la pantalla y en el registro. Sin botón de "ejecutar" | Nulo | Demo |
| A6 Endpoint de decisión | `POST /api/decide` recibe una factura (archivo o campos) y devuelve la decisión con hallazgos. Misma función que usan los canales. Documentado en el README como "para tu propio agente" | Bajo | Paso 31, recortable |

## 3. Definición de las métricas antes de medir

**Autonomía.** Porcentaje de facturas del set cuya decisión del agente coincide con la decisión esperada **sin intervención humana**. Un escalado cuenta como correcto solo si la decisión esperada era escalar. Escalar de más no es seguro, es trabajo que no se ahorró. Contra-métrica visible: tasa de escalado.

**Seguridad.** Número de facturas cuya decisión fue "pagar" y la esperada era frenar o escalar. Objetivo: cero. Es la única métrica con tolerancia cero y bloquea CI.

**Explicabilidad.** Cada decisión tiene explicación con regla, valor observado, umbral y cita del documento. Se mide como cobertura: 100 por ciento de decisiones con los cuatro elementos.

**Exactitud de extracción.** Por campo, contra el valor esperado normalizado. Umbral de paso: monto y beneficiario mayor o igual al 99 por ciento.

## 4. Veredicto

La arquitectura cubre el reto completo. Los seis ajustes que salieron de la matriz ya están incorporados en `arquitectura.md`; cinco entran en la demo y `/api/decide` es el último en el orden de recorte. El más importante para el jurado era A1, porque "saldo insuficiente" aparece literal en la lista de casos trampa y el diseño solo tenía presupuesto.

La forma elegida, modelo que extrae y código que decide, es la única de las consideradas que satisface a la vez los tres criterios de éxito y la restricción descalificante. Las alternativas que parecen "más agente" sacrifican seguridad o explicabilidad; las que parecen "más seguras" sacrifican la capacidad de leer facturas reales. La diferencia frente a otras soluciones no está en el pipeline, que es conocido, sino en tres cosas que se muestran en vivo: evidencia literal por campo, replay al cambiar reglas, y la aprobación que firma el contenido exacto.

## 5. Riesgos de interpretación

- **"Agente" como palabra.** Un jurado puede esperar un bucle de modelo con herramientas. Respuesta en el pitch: el agente es el sistema que decide solo dentro de las reglas y pide permiso fuera de ellas; el modelo es uno de sus roles, no su cerebro. Mostrar el lote decidiendo 25 facturas sin tocar nada.
- **Sobreescalado.** Si el agente escala demasiado, la autonomía cae. Calibrar los umbrales de confianza sobre el set hasta el punto de cero falsos "pagar" con el mínimo de escalados.
- **Demo sin red.** Resultados del set precargados y explicación por plantilla que no depende del modelo.
