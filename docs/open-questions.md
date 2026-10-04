# Preguntas abiertas

Documento vivo. Cuando una pregunta se resuelve se registra la respuesta (fecha y fuente) y, si cambia una
decisión, se actualiza [`decisions.md`](./decisions.md).

## A. Respuestas del propietario (2026-09-29)

| # | Pregunta | Respuesta | Efecto |
| --- | --- | --- | --- |
| A1 | ¿Negocio real o de prueba? | Negocio **real, en producción**. | Todo es solo consulta; las pruebas reales se hacen con cuidado (ADR-013). |
| A2 | ¿Usuario dedicado para el MCP? | **No es posible**; se usa el usuario propio de producción. | ADR-014; riesgos en [`security.md`](./security.md) §3. |
| A3 | ¿Excluir datos personales? | **No excluirlos.** Caso de uso: listado de clientes en Excel sin entrar a Loggro. | ADR-011 (incluidos, redacción opcional) y ADR-015 (exportación a archivo). |
| A4 | ¿Alcance de la fase 1? | Un MCP **funcional para cualquier persona**, cliente de Loggro o desarrollador, que use Restobar. | ADR-007 (instalación local por stdio). |
| A5 | ¿Relación con Loggro? | **Cliente de Loggro**, con API y varias automatizaciones. | Proyecto independiente; el README lo aclara. |
| A6 | ¿Madurez? | **Producción**, para quien lo instale con su token o su usuario y clave. | ADR-009 (npm, SemVer, releases). |
| A7 | ¿Público? | Cualquier persona interesada: empresas, desarrolladores y usuarios. | README y guías de instalación también para personas no técnicas. |

**Aceptadas por defecto** (propuestas anteriores sin objeción): PYMES como siguiente producto cuando
alguien pueda probarlo (A8); nombre `mcp-loggro` en npm (A9); idioma (A10, ADR-012); licencia MIT
(A11); reporte privado de vulnerabilidades de GitHub (A12); contribuciones externas con `main` protegida
(A13); pruebas con Claude Desktop, Claude Code y MCP Inspector (A14); mínimo Node 22.18, CI con 22, 24 y 26 (A15); `pageSize`
máximo 50 y rango de 93 días (A16); zona horaria `America/Bogota` configurable (A17); pruebas de
integración solo manuales (A18).

## B. No documentado por Loggro: confirmar con Loggro o en pruebas reales

| # | Tema | Cómo resolverlo |
| --- | --- | --- |
| B1 | Duración del token de Restobar (`tokenCurrent`) y mensaje exacto al expirar. | 🔎 El JWT de `tokenCurrent` **no trae `exp`** (solo una fecha de emisión): Restobar no anuncia su vigencia. Un token siguió respondiendo el 2026-09-30. Las integraciones prudentes asumen una vigencia corta y renuevan ante un 401 (lo que hace el modo usuario y clave). |
| B2 | **Crítico:** ¿un login nuevo en Restobar invalida los tokens anteriores del mismo usuario? Con el usuario de producción, podría cerrar la sesión del POS o romper automatizaciones. La documentación solo describe `POST /login` → `tokenCurrent`: no hay endpoint para crear tokens adicionales o con nombre, ni para renovar o revocar. 🔎 `lastTokenDevice` no es un segundo token de API: su ejemplo es `fcm_token_example`, un token de notificaciones push del dispositivo. 🔎 El nombre `tokenCurrent` («token actual») sugiere que el servidor guarda uno vigente por usuario, pero no lo prueba. | Sin riesgo: en la próxima renovación semanal, antes de reemplazar el token viejo en las automatizaciones, correr `scripts/smoke-restobar.ts restobar_list_categories` con el token **viejo** (1 solicitud). Si responde bien, conviven varios tokens; si da 401 antes de su `exp`, un login invalida el anterior. |
| B3 | Límites de peticiones de Restobar. | Consultar a Loggro. No hacer pruebas de carga contra producción. |
| B4 | Zona horaria con la que Restobar aplica `dateInit`/`dateEnd`. | Prueba real con facturas de horas conocidas cerca de medianoche. |
| B5 | Qué ocurre al superar el `limit` máximo (error o recorte). | Consultar a Loggro; no hace falta probarlo si el MCP nunca supera el máximo. |
| B6 | Código de permiso necesario para `GET /invoices` y `GET /orders` (el `403` no lo nombra). | Solo importa a quienes usen roles restringidos; documentar lo que se observe. |
| B7 | Moneda de los montos en Restobar. | Consultar a Loggro. |
| B8 | ¿Ofrece Restobar un token de integración de larga duración (como PYMES o Nómina)? | Consultar a Loggro. Sería más seguro que usuario y clave. |
| B9 | ¿Hay entorno de pruebas (sandbox) para Restobar? | Consultar a Loggro. |
| B10 | Términos de uso de la API: ¿permiten herramientas de terceros de código abierto y enviar datos a proveedores de IA? | Consultar a Loggro. |
| B11 | Semántica de `allBusiness` y de los negocios padre/hijo. | Prueba real si el negocio tiene sucursales (C6). |
| B12 | Nómina: ¿los GET «Calcular …» persisten resultados? | Solo relevante si algún día se incluye Nómina. |

## C. Respuestas del propietario (2026-09-29, segunda ronda)

| # | Respuesta | Efecto |
| --- | --- | --- |
| C1 | Sus automatizaciones obtienen el token con `POST /login` (usuario y clave) y lo **renuevan cada semana**. No sabe si un login nuevo invalida el token anterior. | 🔎 El token dura al menos una semana; `scripts/smoke-restobar.ts` imprime su vigencia real sin revelarlo. Las pruebas usan el token actual (modo token, **sin login**) para no arriesgar las automatizaciones. B2 sigue abierta. |
| C2 | Plan **premium**. | Se pueden verificar reportes y el historial de cuadres de caja. |
| C3 | Pruebas reales desde el chat de Claude Code. | El token se configura como variable de entorno del entorno en la nube (nunca pegado en el chat); la variable la toma una sesión nueva. Reglas del propietario: entre 1 y 5 solicitudes por herramienta, solo lectura, nada que modifique. `scripts/smoke-restobar.ts` las hace cumplir. |
| C4 | Preguntó dónde quedarían los archivos exportados. | Explicado: con Claude Desktop, el servidor corre en su equipo y guardaría el archivo en una carpeta local; la alternativa es que Claude arme el Excel en el chat. La decisión (ADR-015) depende del número de clientes, que dará la prueba real. |
| C5 | Propone recibir reportes por GitHub. | GitHub no ofrece mensajes privados y los reportes de conducta no deben ser públicos. Se pospone el Código de Conducta hasta que haya comunidad o un correo del proyecto. |
| C6 | Tiene **varias sucursales, cada una con su propio usuario y clave**. | Una credencial = una cuenta: cada credencial es una instalación o conexión propia (ADR-016). |

## E. Confirmado contra la API real (2026-09-29)

Prueba de humo con `scripts/smoke-restobar.ts` (1 solicitud por herramienta, solo lectura). Solo tipos y
formatos; sin cifras ni datos personales.

| # | Hallazgo | Efecto |
| --- | --- | --- |
| E1 | En Claude Code en la nube, `LOGGRO_RESTOBAR_TOKEN` guarda un marcador que el proxy cambia por el token real. El `fetch` de Node no usa `HTTPS_PROXY` salvo con `NODE_USE_ENV_PROXY=1`; sin él, Restobar recibe el marcador y responde `403` «No tienes autorización para acceder a la información.». | El script exige `NODE_USE_ENV_PROXY=1` cuando hay proxy y se detiene antes de la red si falta. |
| E2 | `GET /stats/totalInvoicesByDays` devuelve un arreglo de `{ _id: { businessId, dayOfMonth }, total, dateInit, dateEnd, totalWithoutTip, tip, count }`; no hay campo `date`. `dayOfMonth` es `YYYY-MM-DD` y los días coinciden con el rango pedido en hora de Colombia. | `restobar_sales_by_day` lee el día de `_id.dayOfMonth` y expone `count` como `invoices`. |
| E3 | Con `pagination=true`, `/invoices`, `/products`, `/orders` y `/clients` traen el total (`pagination.total`). `/categories` y `/paymentMethods` devuelven un arreglo simple. | Sin cambios. |
| E4 | `createdOn` llega como ISO 8601 en UTC (`2026-09-29T21:50:32.463Z`). **`birthdate` no existe**: ausente en los 816 clientes del negocio. | Se conserva por si otros negocios lo envían; la columna del Excel puede salir vacía. |
| E5 | Clientes (forma cruda de los 816): **no hay `city`**; la ubicación viene en `cityDetail { countryCode, stateCode, stateName, cityCode, cityName }`. Hay un bloque opcional `contact { firstName, lastName, email, phone }` (persona de contacto, típico en empresas). `idDocumentType` es número; `checkDigit`, número; también llegan `notes`, `responsibilities`, `responsibilityName`, `isVATCompanyType`, `creditMovement[]` y `totalCreditMovement`. | Ciudad desde `cityDetail.cityName` (lista, resumen y Excel); el Excel suma Departamento y las columnas de contacto. |
| E6 | Pedidos: `complementary` es un objeto `{ isComplementary }`, no booleano. No hay `statusKitchen` (solo `statusKitchenHistory[]`). `product` llega poblado con `category` y `locationsStock[].locationStock` como texto (ID). `modifiedBy` trae el usuario completo (correo, IP, código de confirmación). | Cortesía desde `complementary.isComplementary`. Las herramientas mapean campo por campo: `modifiedBy` nunca sale del servidor. |
| E7 | Factura (`GET /invoices/{id}`): `client` no trae ID (ni `idInternal` ni `_id`); `eInvoice.DIAN.dianState` puede faltar. Trae además `seller`, `paymentMethod` y el desglose `paid.paymentMethodValue[] { paymentMethod, value, tip, ... }`, `products[].categoryId`/`categoryName`, y subtotales e impuestos. | `client.id` queda `null` por diseño de la API. El desglose de pagos no se expone aún. |
| E8 | Productos (`GET /products`, 50 registros): `category` y `locationsStock[].locationStock` llegan **poblados como objeto** (`{ _id, name, … }`); también traen `price` (venta), `inventoryType` y `tax { name, percentage }` por bodega. | Confirmado. Se exponen `categoryId`/`categoryName`, `locationId`/`locationName`, `price`, `inventoryType` e impuesto. Mapa completo en [`restobar-data-map.md`](./restobar-data-map.md). |
| E9 | `restobar_clients_summary` y `restobar_export_clients` recorren todos los clientes en 2 solicitudes; el archivo es XLSX válido. | Sin cambios. |
| E10 | Ampliación (2026-10-04, 1–2 solicitudes por endpoint): responden 200 `/expenses`, `/typeExpenses`, `/providers`, `/inventoryInvoicePayments`, `/ingredients` (con `{ data, count }`), `/units`, `/taxes`, `/tables`, `/promos`, `/reports/reportPurchase`, `reportProduction`, `reportTransfers`, `reportShrinkage`, `reportUtility`, `reportUtilityGroupTypes`, `reportSalesByCategory` y todas las `/stats/*` por período. **Responden 404:** `/inventory`, `/inventory/types/all`, `/inventory/report/*`, `/cashbox` y `/deliveryProviders` (ver E15). | 28 herramientas nuevas verificadas. Mapa en [`restobar-tool-map.md`](./restobar-tool-map.md). |
| E11 | Fechas: reportes y estadísticas usan `dateInitISO`/`dateEndISO`; `/expenses`, `dateInit`/`dateEnd` (ISO). Las fechas devueltas caen dentro del período pedido (00:00–23:59:59.999 de Bogotá). | Las herramientas reciben `YYYY-MM-DD`. |
| E12 | Formas: `/stats/totalOrdersGroupByHours` y `GroupByDays` vienen envueltas (`totalOrdersTodayByHours`, `totalOrdersTodayByDays`) y el grupo es `_id` **numérico**; `/stats/totalSalesByBiller` viene en `{ data }`; ventas por método de pago y por mesa no traen conteo; `reportUtilityGroupTypes` trae `total` pero no `totalSubTotal`/`totalTaxes`; en `/expenses` el tipo de gasto llega como ID (se resuelve con `/typeExpenses`) y `provider` puede faltar. | Lectores tolerantes en `src/tools/restobar/extract.ts`. |
| E13 | Pendiente: `avgCost` de `reportUtility` se interpreta como costo promedio **unitario** y el día de la semana como `$dayOfWeek` de MongoDB (1 = domingo). Ninguno está documentado. | `restobar_product_profitability` marca la utilidad como estimada; validar con el propietario contra un producto de costo conocido. |
| E14 | Errores de conexión: `No fue posible conectar con Restobar` significa que `fetch` falló antes de recibir respuesta (red, DNS, TLS o tiempo vencido), no que Restobar rechazara la consulta. | El cliente HTTP ahora distingue el tiempo vencido y registra `error` y `code` (p. ej. `ECONNRESET`) en `loggro.request.failed`, sin URL ni token. |
| E15 | **La documentación oficial tiene rutas equivocadas.** El 404 trae el HTML de Express «Cannot GET /cashbox»: la ruta no existe. Probando variantes: `/cashboxes` → 200 (`{ data, count }` con `pagination=true`; filtros `status` y `dateInit`/`dateEnd` funcionan), `/inventories` → 200, `/inventories/types/all` → 200, `/deliveryProvider` → 200, `/inventories/report/purchases` → 403 «Solo usuarios administradores pueden realizar esta acción.». | Nuevas: `restobar_list_cash_closings`, `restobar_list_inventory_movements`, `restobar_list_inventory_types`, `restobar_list_delivery_providers`. `documentedPath` en la allowlist conserva la ruta documentada. |
| E16 | Cuadres: por método de pago llegan `totalInit`, `totalNow` y `totalCashier`. Se interpretan como base inicial, valor del sistema y valor contado, y la diferencia como contado − sistema. Sin confirmar con el propietario. | Validar contra un cuadre conocido en la pantalla de Restobar. |
| E17 | Límites: `/products` no hace cumplir su máximo documentado (100): `limit=101` devolvió 101 registros (≈ 21 KB cada uno, 2,1 MB). `/categories` ignora `pagination`/`limit` sin error. | Límites propios del MCP obligatorios (ver `tool-design.md` §2.1). |

## D. Preguntas pendientes para el propietario (histórico)

Las preguntas de esta sección se respondieron en la sección C.

| # | Pregunta | Por qué importa |
| --- | --- | --- |
| C1 | ¿Cómo obtienen el token tus automatizaciones actuales? ¿Con `POST /login` y este mismo usuario? ¿Has visto que un login en otro lugar invalide un token? ¿Cuánto dura el token en tu experiencia? | Resuelve B1 y B2 sin experimentar en producción. |
| C2 | ¿Qué plan tiene tu negocio en Restobar (premium o no)? | Los reportes y el historial de cuadres de caja requieren premium; define qué herramientas se pueden verificar. |
| C3 | ¿Dónde ejecutamos las pruebas contra producción? Propuesta: **tú, en tu equipo**, con un comando de solo lectura que no imprime datos. Alternativa: guardar las credenciales como secretos del entorno de Claude Code en la nube. | Las credenciales y los datos reales no deberían salir de tu equipo sin necesidad. |
| C4 | Exportación: ¿basta con `.xlsx` o también quieres `.csv`? ¿En qué carpeta deben guardarse por defecto? | Define ADR-015. |
| C5 | ¿Qué nombre va como titular del copyright (hoy «Andrew») y qué contacto publicamos para el Código de Conducta? | Proyecto público en producción: conviene tener Código de Conducta con contacto real. |
| C6 | ¿Tu negocio tiene sucursales (negocio padre e hijos) en Restobar? | Define si hay que soportar `allBusiness` desde la fase 1. |
