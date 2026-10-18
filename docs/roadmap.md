# Hoja de ruta

Qué hace Yunque hoy, hacia dónde va y qué se dejó fuera a propósito. Lo de "Hacia dónde va" **no está implementado**: es el camino, no una promesa de la demo.

## Lo que hace hoy

- **Recibe facturas** por subida en pantalla (PDF o foto), por lote del periodo, por correo real y por Telegram. Una misma entrega nunca se procesa dos veces.
- **Deja armar una factura de prueba** con proveedor, monto, cuenta y una nota: el cliente ve pagar, escalar y frenar con datos que eligió.
- **Lee con IA y verifica con código:** cada dato con su cita en el documento y su confianza; una segunda pasada con otro modelo cuando la verificación falla; detección de instrucciones ocultas.
- **Decide con 21 controles deterministas:** pagar, frenar o escalar a una persona. El modelo nunca decide, y lo que diga una factura solo endurece el veredicto.
- **Explica cada decisión** en palabras simples, con la regla, el valor y el umbral, y el dato señalado en el documento.
- **Una persona resuelve lo que escala:** aprueba con checklist y firma del contenido exacto, corrige un dato, rechaza o registra al proveedor nuevo desde su factura.
- **La empresa pone las reglas:** límites, presupuesto en USD sobre varias monedas, beneficiarios y qué hacer en cada caso, en versiones firmadas, con la vista de qué facturas cambiarían antes de guardar.
- **Controles de emergencia y de criterio:** pagos, modo de prueba, autonomía y doble firma opcional para todo lo que afloja el control.
- **Le responde a otros sistemas:** API de decisión con llave por empresa e idempotencia, y servidor MCP para Claude u otro agente de IA, remoto o local.
- **Todo queda escrito** en una bitácora que no se edita ni se borra, y se mide: autonomía, cero pagos indebidos, exactitud, costo y tiempo por factura.
- **Prepara la orden de pago** con la cuenta registrada del proveedor, sin ejecutarla.

## Hacia dónde va

| Paso | Qué resuelve |
|---|---|
| **Ejecutar los pagos por las rutas de Blinka** | La orden ya sale preparada con beneficiario, monto, moneda, ruta y fecha. El paso siguiente es ejecutarla, con el modo de prueba como paso previo obligatorio en cada empresa nueva. |
| **Inicio de sesión con roles y doble firma con identidad real** | En la demo una persona puede elegir los dos nombres de la lista. En producción cada firma es de una persona autenticada, con roles y separación de funciones. |
| **Verificar un cambio de cuenta por un canal independiente** | Hoy una cuenta distinta de la registrada se frena. El paso siguiente es confirmarla con el contacto registrado del proveedor (llamada o mensaje), nunca por el canal que trajo la factura. |
| **Factura electrónica como evidencia** | Validar la factura contra la autoridad tributaria de cada país (DIAN, SAT, NF-e) antes de pagar: prueba de que existe y de que el emisor es quien dice ser. |
| **Conciliación y calendario de pagos** | Cuánto sale cada día, por qué ruta y en qué moneda, y confirmar cada pago contra el extracto bancario. |
| **Sugerencias de política** | "Esta regla escaló 12 facturas y las 12 se aprobaron: ¿subir el umbral?". Una persona las acepta o las descarta; nunca se aplican solas. |
| **Registro de agentes externos** | Cada agente que usa la API o el MCP con dueño, propósito, presupuesto y beneficiarios permitidos propios. |

## Lo que se descartó a propósito

| Idea | Por qué no |
|---|---|
| Ejecutar pagos reales en la demo | Fuera del alcance del reto: la demo nunca mueve dinero |
| Que el modelo decida | Las reglas deciden; el modelo solo lee. Es la base de la seguridad |
| Chat conversacional con el agente | Mueve la atención hacia el modelo y lejos de las reglas |
| Varios agentes de modelo conversando | Latencia, costo y explicabilidad peores |
| Reglas escritas en lenguaje libre y compiladas por el modelo | La política la escribe la empresa en un catálogo fijo; el modelo no la toca |
| Extensión de navegador | Un canal más que no cambia la decisión |
| OCR especializado de terceros | Otro proveedor; la lectura con verificación ya cubre el set |
