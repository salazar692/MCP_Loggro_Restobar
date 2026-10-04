# Mapa de datos de Restobar: API real → herramientas MCP

Documento de referencia para personas y para agentes de IA que trabajen en este repositorio. Explica
**cómo llega cada dato desde la API real de Restobar** (`https://api.pirpos.com`) y **cómo queda
mapeado** en las herramientas MCP y en el Excel de clientes.

- **Fuente:** respuestas reales de un negocio en producción (2026-09-29), analizadas con
  `SMOKE_RAW_SHAPE=1` en `scripts/smoke-restobar.ts`. En cada respuesta se combinaron todos los
  registros (hasta 50 por página; los 816 clientes completos). Aquí solo se registran **nombres de
  campo, tipos y formatos**, nunca valores, cifras ni datos personales.
- **Código:** esquemas de entrada en [`src/loggro/restobar/schemas.ts`](../src/loggro/restobar/schemas.ts);
  mapeo de salida en [`src/tools/restobar/`](../src/tools/restobar/).
- **Documentación oficial:** Loggro no publica los esquemas de respuesta. Varios campos difieren de
  lo que se suponía (ver «Errores corregidos»). **Ante una duda, confía en este documento y
  verifícalo con el script, no con suposiciones.**

## 1. Convenciones de la API

| Aspecto | Cómo viene | Cómo se trata |
| --- | --- | --- |
| IDs | `_id` en texto, formato ObjectId de MongoDB (24 hex). En documentos embebidos a veces se llama `idInternal`. | Se expone como `id`. |
| Fechas y horas | ISO 8601 en **UTC** con milisegundos: `2026-09-29T21:50:32.463Z` (`createdOn`, `modifiedOn`, `paid.createdOn`…). | Se devuelven tal cual (UTC). El Excel las convierte a la zona del negocio (`LOGGRO_TIMEZONE`, por defecto `America/Bogota`). |
| Días (estadísticas) | `YYYY-MM-DD` en `_id.dayOfMonth`, ya en hora local del negocio. | Se usa tal cual. |
| Filtros de fecha | Instantes ISO (`dateInit`/`dateEnd`, `dateInitISO`/`dateEndISO`). | Las herramientas reciben `YYYY-MM-DD` y los convierten a 00:00:00.000–23:59:59.999 locales (`dayRangeToIso`). Verificado: los días de `sales_by_day` coinciden con la hora de Colombia. |
| Montos | `number` **enteros** (pesos colombianos sin decimales) en facturas, pedidos y precios. Costos promedio y de compra por bodega pueden traer decimales. | Se devuelven como número, sin formato de moneda. |
| Zona horaria | Cada factura trae `timeZone` (p. ej. `America/Bogota`). | Informativo. |
| Paginación | Con `pagination=true`: `{ data: [...], count }`. `page` empieza en 0. | `count` → `pagination.total`. `/categories` y `/paymentMethods` devuelven un arreglo simple, sin total. |
| Referencias | Según el endpoint, un campo de referencia llega como **ID en texto** o **poblado** (objeto completo con `_id` y `name`). Ej.: `category` es objeto en `/products` y texto en el producto embebido de `/orders`. | El esquema `ref` acepta ambas formas y normaliza a `{ id, name }`. |
| Campos opcionales | Muchos campos **no se envían** cuando no tienen valor (ausentes, no `null`). | Los esquemas son tolerantes: ausente o tipo inesperado → `null`. |
| Borrado lógico | `deleted`, `deletedInfo.isDeleted`. | No se exponen. |

## 2. Facturas — `GET /invoices` y `GET /invoices/{id}`

Herramientas: `restobar_list_invoices` (resumen) y `restobar_get_invoice` (detalle = resumen + extras).

| Campo en la API | Tipo / formato | Salida MCP | Notas |
| --- | --- | --- | --- |
| `_id` | ObjectId | `id` | |
| `invoicePrefix` | texto | `prefix` | |
| `number` | texto | `number` | También existen `seq` (entero) y `numberUnique` (texto). |
| `status` | enum; observado `Pagada` | `status` | El filtro acepta `Pendiente`, `Pagada`, `Anulada`. |
| `type` | enum; observado `Factura` | `type` | ⚠️ El filtro de entrada usa `Normal`/`FacturaElectronica` (según la doc oficial); el valor guardado es `Factura`. No verificado cómo filtra la API. |
| `subTotal`, `totalDiscount`, `totalTaxes`, `tip`, `total`, `totalPaid` | entero | mismos nombres | También vienen `totalBruto`, `totalBaseTax`, `change`, `discountAdditional*`. |
| `paymentMethod` | texto (nombre del método) | `paymentMethod` | |
| `paid.paymentMethodValue[]` | `{ paymentMethod: texto, value: entero, tip: entero, cashBox: ObjectId, approbationNumber, deliveryCost, createdOn }` | detalle: `payments[] { method, value, tip }` | Desglose cuando se paga con varios métodos. |
| `seller` | `{ idInternal, name }` | `seller` (nombre) | |
| `cashier` | `{ idInternal, name }` | detalle: `cashier` (nombre) | |
| `table` | `{ idInternal, name }` | `table { id, name }` | |
| `client` | `{ name, lastName, phone, email, document, address, idDocumentType (texto), isSocialReason, cityDetail, … }` | `client { id, name, phone }` | ⚠️ **No trae ID** (`idInternal` ausente): `client.id` es `null` por diseño de la API. `phone` es dato personal (se omite con redacción). |
| `products[]` | `{ idInternal, name, code, categoryId, categoryName, quantity, price, priceNormal, discount, total, totalBruto, taxes[], avgCost, costProduct, sellerId, … }` | detalle: `products[] { id, name, category, quantity, unitPrice, discount, total }` | `price` es el precio unitario. |
| `delivery` | `{ isDelivery, deliveryGuy, percentagePerSale, … }` | detalle: `isDelivery`, `deliveryProvider` | `deliveryProvider` no apareció en la muestra. |
| `eInvoice.DIAN.dianState` | texto, **ausente** en todas las facturas revisadas | `dianState` | Solo existiría en facturas electrónicas. |
| `credit.dueDate` | ausente en la muestra | detalle: `creditDueDate` | |
| `createdOn` | ISO UTC | `createdOn` | |
| `business { name, nit, address, phone, web }` | textos | — | Datos del propio negocio; no se exponen. |
| `note1..3`, `observations`, `orders[]`, `cashBox`, `turn`, `printType` (`Tirilla`) | varios | — | No expuestos. |

## 3. Productos — `GET /products`

Herramienta: `restobar_list_products`.

| Campo en la API | Tipo / formato | Salida MCP | Notas |
| --- | --- | --- | --- |
| `_id`, `name` | ObjectId, texto | `id`, `name` | |
| `category` | **objeto poblado** `{ _id, name, description, isActive, … }` | `categoryId`, `categoryName` | Antes se leía como texto y salía siempre `null`. |
| `barcode` | texto o dígitos, opcional | `barcode` | |
| `type` | enum; observado `Normal` | `type` | |
| `inventoryType` | enum `PerUnit` \| `WithIngredients`, opcional | `inventoryType` | |
| `price` | entero | `price` | Precio de venta general. |
| `pricePurchase` | entero | `purchaseCost` | |
| `stock`, `stockMinimum` | entero | mismos nombres | |
| `isActive` | booleano | `isActive` | |
| `locationsStock[]` | `{ locationStock: objeto poblado { _id, name, isMain }, isMain, stock, stockMinimum, price?, pricePurchase, avgCost (decimal), tax: { name, percentage, type } \| null, … }` | `locations[] { locationId, locationName, isMain, stock, stockMinimum, price, taxName, taxPercentage }` | `price` por bodega suele faltar: usa el `price` general. |
| `ingredients[]`, `extra[]`, `configCombo`, `externalIntegration`, `urlImage`, `description` | varios | — | No expuestos. La respuesta es pesada (≈23 KB por producto): usa páginas pequeñas. |

## 4. Categorías — `GET /categories` · Métodos de pago — `GET /paymentMethods`

| Endpoint | Campos en la API | Salida MCP |
| --- | --- | --- |
| `/categories` (arreglo simple) | `_id`, `name`, `description` (a menudo vacío), `isActive`, `menu.source`, `externalIntegration`, fechas | `restobar_list_categories`: `id`, `name`, `description`, `isActive` |
| `/paymentMethods` (arreglo simple) | `_id`, `name`, fechas | `restobar_list_payment_methods`: `id`, `name` |

El `name` de un método de pago es el que aparece en `invoice.paymentMethod` y el que acepta el filtro
`paymentMethodName` de `restobar_list_invoices`.

## 5. Pedidos — `GET /orders`

Herramienta: `restobar_list_orders`.

| Campo en la API | Tipo / formato | Salida MCP | Notas |
| --- | --- | --- | --- |
| `_id` | ObjectId | `id` | |
| `product` | objeto poblado (producto completo; `category` y `locationStock` como ID en texto) | `product { id, name }` | |
| `table` | objeto poblado `{ _id, name, capacity, … }` | `table { id, name }` | |
| `seller` | `{ _id, name, lastName }` | `seller` (nombre completo) | |
| `quantity`, `unit_price`, `total` | entero | `quantity`, `unitPrice`, `total` | |
| `status` | texto | `status` | |
| `complementary` | **objeto** `{ isComplementary }` | `complementary` (booleano) | Antes se leía como booleano y salía siempre `null`. |
| `statusKitchen` | **no existe**; solo `statusKitchenHistory[]` | `kitchenStatus` | Siempre `null` con la API actual. |
| `causeCancel` | texto, opcional | `cancelReason` | |
| `createdOn` | ISO UTC | `createdOn` | |
| `modifiedBy` | usuario completo: correo, teléfono, documento, **IP**, **código de confirmación** | — | ⚠️ Sensible. Nunca se expone: las herramientas copian campo por campo. |

## 6. Clientes — `GET /clients`

Herramientas: `restobar_list_clients`, `restobar_clients_summary` y `restobar_export_clients` (Excel).
Las dos últimas descargan todos los clientes en lotes de 500.

| Campo en la API | Tipo / formato | Salida MCP (`list_clients`) | Columna del Excel | Notas |
| --- | --- | --- | --- | --- |
| `_id` | ObjectId | `id` | ID Restobar | |
| `name`, `lastName` | texto (`lastName` opcional) | `name`, `lastName` | Nombre, Apellido | |
| `isSocialReason` | booleano | `isCompany` | Empresa (Sí/No) | |
| `documentName` | texto (tipo de documento) | `documentType` | Tipo de documento | También `idDocumentType` (número). |
| `document` | texto, opcional | `document` 🔒 | Documento 🔒 | Texto: conserva ceros a la izquierda. |
| `checkDigit` | número, opcional | `checkDigit` 🔒 | DV 🔒 | |
| `email`, `phone`, `address` | texto, opcionales | 🔒 | Correo, Teléfono, Dirección 🔒 | |
| `cityDetail` | `{ countryCode, stateCode, stateName, cityCode, cityName }` | `city` ← `cityName` | Ciudad, Departamento | ⚠️ **No existe `city`**. |
| `contact` | `{ firstName, lastName, email, phone }`, opcional | — | Contacto, Correo de contacto, Teléfono de contacto 🔒 | Persona de contacto, típico en empresas. |
| `birthdate` | **no existe** (ausente en los 816 clientes) | `birthdate` | Fecha de nacimiento | Se conserva por si otros negocios lo envían; hoy siempre vacío. |
| `points` | entero | `loyaltyPoints` | Puntos | |
| `createdOn` | ISO UTC | `createdOn` | Creado (`YYYY-MM-DD HH:MM`, hora local) | |
| `notes`, `responsibilities`, `responsibilityName`, `isVATCompanyType`, `creditMovement[]`, `totalCreditMovement` | varios | — | — | No expuestos. `totalCreditMovement` sería el saldo a crédito. |

🔒 = dato personal: se omite si `LOGGRO_REDACT_PERSONAL_DATA=true`.

## 7. Ventas por día — `GET /stats/totalInvoicesByDays`

Herramienta: `restobar_sales_by_day`.

| Campo en la API | Tipo / formato | Salida MCP |
| --- | --- | --- |
| `_id.dayOfMonth` | `YYYY-MM-DD` (hora local) | `date` |
| `_id.businessId` | ObjectId | — |
| `total` | entero | `total` (y `grandTotal` = suma) |
| `count` | entero | `invoices` |
| `totalWithoutTip`, `tip` | entero | — |
| `dateInit`, `dateEnd` | ISO UTC | — |

⚠️ No hay campo `date`: antes todas las fechas salían `null`.

## 8. Errores corregidos gracias a las respuestas reales

| Herramienta | Síntoma | Causa |
| --- | --- | --- |
| `restobar_sales_by_day` | `date` siempre `null` | El día viene en `_id.dayOfMonth`. |
| `restobar_list_products` | `categoryId` y `locationId` siempre `null` | `category` y `locationStock` llegan poblados como objeto. |
| Clientes (lista, resumen, Excel) | Ciudad vacía; `topCities` vacío | La ciudad viene en `cityDetail.cityName`. |
| `restobar_list_orders` | `complementary` siempre `null` | Es un objeto `{ isComplementary }`. |
| Facturas | Sin método de pago, vendedor, subtotales ni desglose | Campos existentes que no se mapeaban. |

## 9. Herramientas de la ampliación

Gastos, compras, inventario, reportes, estadísticas y configuración se documentan en
[`restobar-tool-map.md`](./restobar-tool-map.md) (estado de los 104 endpoints de lectura y formas
observadas). Usan lectores tolerantes (`src/tools/restobar/extract.ts`) en lugar de esquemas Zod porque
Loggro no publica esquemas de respuesta fiables; igual copian campo por campo.

## 10. Modo remoto

En un servidor remoto (ver [`remote-integration.md`](./remote-integration.md)) el mapeo de datos es
idéntico; la única diferencia es que no existe `restobar_export_clients`.

## 11. Cómo verificar o ampliar este mapa

```sh
# En Claude Code en la nube (detrás de proxy) es obligatorio NODE_USE_ENV_PROXY=1:
# sin él, Node no usa el proxy, Restobar recibe el marcador del token y responde 403.
SMOKE_RAW_SHAPE=1 NODE_USE_ENV_PROXY=1 node scripts/smoke-restobar.ts restobar_list_products
```

- `SMOKE_RAW_SHAPE=1` imprime la forma cruda combinada de todos los registros: `string:iso-utc`,
  `string:objectId`, `string:dígitos`, `string:texto`, `number:int`/`number:dec`, `ausente` (el campo
  falta en algunos registros) y `enum:<valor>` solo para campos de catálogo (`status`, `type`…).
  Nunca imprime valores de personas ni montos.
- `SMOKE_PROBE=1` consulta directamente las operaciones nuevas (estado, conteo y rango de fechas, sin
  valores) para descubrir qué endpoints existen antes de crear una herramienta.
- `SMOKE_INVOICE_ID=<id>` prueba `restobar_get_invoice` sin gastar una solicitud de la lista.
- `SMOKE_LEDGER=<archivo>` y `SMOKE_MAX_REQUESTS=<n>` abren una ronda con su propio tope.
- Reglas: solo lectura, sin `POST /login`, máximo de solicitudes por herramienta, y nada de datos
  personales ni cifras en chats, archivos o commits.

Al cambiar un esquema: actualiza este documento, añade una prueba en `tests/e2e/server.test.ts` con
la forma real (datos ficticios) y corre `npm run check`.
