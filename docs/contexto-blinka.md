# Contexto de Blinka

> Qué es Blinka, qué sabemos de su producto y cómo usamos eso en Yunque. Solo lo que cambia decisiones de diseño. Información pública a octubre de 2026.

## 1. Qué es Blinka

- **Blinka Tech Corp**, corporación de Delaware. Es una fintech, no un banco: los servicios bancarios los prestan bancos aliados (Portage Bank y Erebor Bank, N.A. según distintas fuentes) y la infraestructura de stablecoins la provee Mural Pay, Inc.
- Fundada por colombianos (Juan Pablo Linares, CEO, y Sebastián Linares). Entró al batch Fall 2026 de Y Combinator. Procesó más de USD 10 millones en sus primeros dos meses.
- **Posicionamiento:** "Banking, without borders. The banking platform for global companies." Cuentas en USD, pagos globales, tarjetas y tesorería en una sola plataforma.
- **Cliente objetivo:** startups latinoamericanas constituidas en EE. UU., empresas tecnológicas con equipos distribuidos y plataformas que manejan múltiples entidades y volumen. Clientes públicos: Didit, Braven, Lazo, Bricksave, Dapta, Creditop, Zolvo.
- Entre sus clientes está **Dapta**, la otra empresa del hackathon.

## 2. Qué hace su producto

### Cuentas en USD
Recibir USD por ACH o wire y mantener saldo en dólares. Cada entidad de la compañía puede tener su cuenta con datos de ruteo de EE. UU.

### Pagos globales
Tres tipos de transferencia: bancaria, local y onchain.

| Destino | Moneda | Ruta (rail) |
|---|---|---|
| Estados Unidos | USD | ACH, Wire |
| 200+ países | USD | SWIFT |
| Perú, Panamá, China, Hong Kong | USD | Ruta local USD |
| Europa | EUR | SEPA |
| Colombia | COP | Bre-B, transferencia bancaria (recibe COP por PSE) |
| Brasil | BRL | Pix, TED |
| México | MXN | SPEI |
| Argentina | ARS | CBU / CVU / Alias |
| Chile | CLP | Transferencia bancaria |
| Perú | PEN | Transferencia bancaria |
| Bolivia | BOB | Transferencia bancaria |
| Costa Rica | CRC | Transferencia bancaria |
| Sudáfrica | ZAR | Transferencia bancaria |
| Onchain | USDC | Base, Ethereum, Polygon, Celo, Solana |

Nota de Blinka: "Transfer times vary by rail and receiving bank." Ejemplo que ellos mismos destacan: Estados Unidos a Colombia, USD a COP, por Bre-B.

### Tarjetas y tesorería
Tarjeta Visa Infinite empresarial sin recargo de FX. Tesorería en fondos de BNY Dreyfus y Morgan Stanley. No aplican al reto.

### Back office
- **Invoicing:** crear facturas y cobrar a la cuenta en USD.
- **Vendor management:** "Keep your vendors and their payment details in one place."
- **Accounting con automatizaciones:** "reduce the work between a payment and your books."
- **Integraciones:** QuickBooks y Stripe.

En los términos de servicio aparece además **Counterparty Management**: "tools for managing vendor relationships, payment recipients, and business contacts."

## 3. Lo que Blinka NO tiene público (y es la oportunidad)

- **No hay API pública ni documentación para desarrolladores.** docs.blinka.co es solo el centro legal.
- **No hay flujos de aprobación, roles ni límites de pago documentados.** Los términos definen "Authorized User" como cualquier persona que la empresa designe, sin niveles de permiso.
- **No hay nada de agentes ni IA** en su producto.

Conclusión: el reto pide exactamente la capa que a Blinka le falta. Yunque no compite con su app; es la capa de decisión que se sienta encima de su vendor management y sus rutas de pago.

## 4. Cómo lo usamos en Yunque

### 4.1 Formato de la orden de pago
Cuando Yunque decide **pagar**, la decisión produce una orden en el idioma de Blinka, lista para que un humano o una integración futura la ejecute:

```yaml
payment_order:
  beneficiary: Laura Gómez (contratista, Colombia)
  amount: 4200000
  currency: COP
  rail: Bre-B
  source: USD account
  fx_from: USD
  due_date: 2026-11-05
```

Las monedas y rutas válidas son las de la tabla de la sección 2. Si la factura pide una ruta o moneda que Blinka no soporta, es motivo de **frenar**, no de inventar una ruta.

### 4.2 Empresa ficticia
La empresa del set de datos debe parecer un cliente real de Blinka:
- Constituida en EE. UU. (Delaware), con cuenta en USD.
- Equipo y contratistas en Colombia, México, Argentina y Brasil. Proveedores SaaS en EE. UU. y Europa.
- Decenas de pagos al mes, en COP, MXN, ARS, BRL, EUR y USD.
- Presupuesto mensual en USD; las facturas en moneda local se evalúan convertidas a USD con una tasa de referencia fija del set.

### 4.3 Vocabulario
Usar los términos de Blinka en la interfaz, el registro de decisiones y el README para que encaje en su producto sin traducción:

| Usar | Evitar |
|---|---|
| vendor / beneficiario | proveedor genérico sin datos de pago |
| counterparty | tercero |
| payment recipient | destinatario |
| rail / ruta de pago | método |
| authorized user | administrador |
| transaction | movimiento |
| business day (lunes a viernes, sin festivos federales de EE. UU.) | día hábil sin definir |

### 4.4 Lo que NO hacemos
Por el alcance del reto y por respeto al producto de Blinka: no replicamos su app, no abrimos cuentas, no verificamos identidad de empresas, no decidimos cumplimiento ni fraude, no movemos dinero.

## Fuentes

- Sitio de Blinka: <https://blinka.co/>
- Centro legal y términos de servicio: <https://docs.blinka.co/legal/terms-of-service>
- La República, "Colombianos crearon una fintech en EE. UU. que ya procesó más de US$10 millones": <https://www.larepublica.co/finanzas/colombianos-crearon-una-fintech-en-ee-uu-que-ya-proceso-mas-de-us-10-millones-4500136>
- Valora Analitik sobre Blinka: <https://www.valoraanalitik.com/?p=616519>
- Enter.co, "Blinka entra a Y Combinator": <https://www.enter.co/?p=587603>
