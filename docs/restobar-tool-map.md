# Mapa completo: endpoints de lectura de Restobar → herramientas MCP

Estado de **los 104 endpoints de lectura** del inventario oficial
([`loggro-api/inventory/restobar.md`](./loggro-api/inventory/restobar.md)). Las escrituras (59) y los
endpoints de SuperAdmin están excluidos por diseño (solo lectura). Verificado contra la API real el
2026-10-04 con `scripts/smoke-restobar.ts`: **las 41 herramientas respondieron OK en una ronda completa**
(una llamada por herramienta). Solo se registran estados HTTP, nombres de campo y tipos,
nunca valores.

| Estado | Significado | Endpoints |
| --- | --- | --- |
| ✅ | Tiene herramienta y respondió bien con la API real | 38 |
| ⛔ | No disponible: ruta documentada 404, ruta real que exige administrador (403) o error interno de Restobar (500) | 4 |
| ⏸️ | Disponible, sin herramienta (duplicado, operativo o de poco uso); candidato futuro | 36 |
| 🚫 | Excluido: consulta por ID redundante, vista de un rol operativo o efecto externo | 26 |

## Herramientas por tema

| Tema | Herramientas |
| --- | --- |
| Ventas | `restobar_sales_by_day`, `restobar_sales_by_month`, `restobar_sales_by_product`, `restobar_sales_by_category`, `restobar_sales_by_payment_method`, `restobar_sales_by_seller`, `restobar_sales_by_biller`, `restobar_sales_by_table`, `restobar_sales_by_delivery_provider`, `restobar_orders_by_hour`, `restobar_orders_by_weekday` |
| Rentabilidad | `restobar_product_profitability`, `restobar_profitability_summary` |
| Gastos | `restobar_list_expenses`, `restobar_expenses_summary`, `restobar_list_expense_types` |
| Compras y proveedores | `restobar_purchases_report`, `restobar_list_purchase_payments`, `restobar_list_providers` |
| Caja | `restobar_list_cash_closings` |
| Inventario | `restobar_list_inventory_movements`, `restobar_list_inventory_types`, `restobar_list_ingredients`, `restobar_get_product`, `restobar_production_report`, `restobar_transfers_report`, `restobar_shrinkage_report` |
| Facturas, pedidos y clientes | `restobar_list_invoices`, `restobar_get_invoice`, `restobar_list_orders`, `restobar_list_clients`, `restobar_clients_summary`, `restobar_export_clients` (solo local) |
| Catálogo y configuración | `restobar_list_products`, `restobar_list_categories`, `restobar_list_payment_methods`, `restobar_list_delivery_providers`, `restobar_list_tables`, `restobar_list_taxes`, `restobar_list_units`, `restobar_list_promos` |

### Equivalencias con lo pedido

| Pedido | Herramienta |
| --- | --- |
| `restobar_list_expenses` (gastos por período) | `restobar_list_expenses` |
| `restobar_expenses_summary` (total por período/categoría) | `restobar_expenses_summary` (y `byExpenseType` en `restobar_list_expenses`) |
| `restobar_purchase_report` / `restobar_supplier_purchases` | `restobar_purchases_report` (líneas + `byProvider`) |
| `restobar_ingredient_purchases` | `restobar_purchases_report` (cada línea es un ingrediente) |
| `restobar_inventory_movements` | `restobar_list_inventory_movements` (ruta real `/inventories`) |
| `restobar_inventory_transfers` | `restobar_transfers_report` |
| `restobar_purchase_payments` | `restobar_list_purchase_payments` |
| `restobar_sales_summary` | `restobar_sales_by_day`, `restobar_sales_by_month` y las demás de ventas |
| `restobar_profitability_summary` | `restobar_profitability_summary` y `restobar_product_profitability` |

## Notas de la API real

- **Rutas mal documentadas:** la documentación oficial escribe `/cashbox`, `/inventory` y
  `/deliveryProviders`, pero la API responde «Cannot GET …» (ruta inexistente). Las rutas reales son
  `/cashboxes`, `/inventories` y `/deliveryProvider`. En la allowlist cada operación guarda la ruta real
  en `path` y la documentada en `documentedPath`; la prueba de contrato verifica la documentada.

- **Fechas:** los reportes y estadísticas reciben `dateInitISO`/`dateEndISO`; `/expenses`, `dateInit`/`dateEnd`.
  Las herramientas convierten `YYYY-MM-DD` a 00:00–23:59:59.999 de la zona del negocio. Verificado: las
  fechas devueltas caen dentro del período pedido.
- **Respuestas envueltas:** `/stats/totalOrdersGroupByHours` → `{ totalOrdersTodayByHours: [...] }`,
  `/stats/totalOrdersGroupByDays` → `{ totalOrdersTodayByDays: [...] }`, `/stats/totalSalesByBiller` →
  `{ data: [...] }`, `/reports/reportUtilityDeliveryProvider` → `{ reportInvoicesDeliveryProvider: [...] }`,
  reportes de ventas → `{ reportByProduct | reportByCategory: [...] }`, compras → `{ purchases, ivp }`.
- **Etiquetas de grupo:** en horas y días de la semana el grupo llega como `_id` numérico; en el resto,
  como campo propio o dentro de `_id`. Ventas por método de pago y por mesa no informan conteo.
- **Utilidad por producto:** `avgCost` se interpreta como costo promedio **unitario**; la utilidad es una
  estimación (ver `open-questions.md`).
- **Premium:** si el plan no lo permite, Restobar responde 402 y la herramienta lo explica.

## Endpoint por endpoint

| Endpoint | Estado | Herramienta o motivo | Documentación |
| --- | --- | --- | --- |
| `/categories` | ✅ | `restobar_list_categories` | [consultarcategorias](https://developer.loggro.com/reference/consultarcategorias) |
| `/categories/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarcategoriaporid](https://developer.loggro.com/reference/consultarcategoriaporid) |
| `/categories/products/all` | ⏸️ | Respuesta muy pesada (todas las categorías con todos sus productos). | [consultarcategoriasconproductos](https://developer.loggro.com/reference/consultarcategoriasconproductos) |
| `/ingredients` | ✅ | `restobar_list_ingredients` | [consultaringredientes](https://developer.loggro.com/reference/consultaringredientes) |
| `/ingredients/onlyIngredient` | ⏸️ | `restobar_list_ingredients` cubre la búsqueda. | [consultarsoloingredientes](https://developer.loggro.com/reference/consultarsoloingredientes) |
| `/ingredients/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultaringredienteporid](https://developer.loggro.com/reference/consultaringredienteporid) |
| `/inventory` | ✅ | `restobar_list_inventory_movements`. **Ruta real: `/inventories`**. | [consultarmovimientosinventario](https://developer.loggro.com/reference/consultarmovimientosinventario) |
| `/inventory/types/all` | ✅ | `restobar_list_inventory_types`. **Ruta real: `/inventories/types/all`**. | [consultartiposinventario](https://developer.loggro.com/reference/consultartiposinventario) |
| `/inventory/{id}` | ⛔ 500 | La ruta documentada da 404; la real `/inventories/{id}` responde **HTTP 500 con `{}`** incluso con un ID tomado del propio listado (error interno de Restobar, 2026-10-04). El listado ya trae los ítems. | [consultarmovimientoporid](https://developer.loggro.com/reference/consultarmovimientoporid) |
| `/inventory/report/purchases` | ⛔ 403 | Ruta real `/inventories/report/purchases`: «Solo usuarios administradores». Se usa `/reports/reportPurchase`. | [reportecomprasingredientes](https://developer.loggro.com/reference/reportecomprasingredientes) |
| `/inventory/report/productions` | ⛔ | Ruta documentada 404; se usa `/reports/reportProduction`. | [reporteproduccioningredientes](https://developer.loggro.com/reference/reporteproduccioningredientes) |
| `/inventory/report/transfers` | ⛔ | Ruta documentada 404; se usa `/reports/reportTransfers`. | [reportetrasladosingredientes](https://developer.loggro.com/reference/reportetrasladosingredientes) |
| `/clients` | ✅ | `restobar_list_clients`, `restobar_clients_summary`, `restobar_export_clients` | [consultarclientes](https://developer.loggro.com/reference/consultarclientes) |
| `/clients/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarclienteporid](https://developer.loggro.com/reference/consultarclienteporid) |
| `/deliveryProviders` | ✅ | `restobar_list_delivery_providers`. **Ruta real: `/deliveryProvider`** (singular). | [consultarproveedoresdomicilio](https://developer.loggro.com/reference/consultarproveedoresdomicilio) |
| `/deliveryProviders/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarproveedordomicilioporid](https://developer.loggro.com/reference/consultarproveedordomicilioporid) |
| `/events` | ⏸️ | Responde 200; eventos del negocio, poco uso. Candidato futuro. | [consultareventos](https://developer.loggro.com/reference/consultareventos) |
| `/events/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultareventoporid](https://developer.loggro.com/reference/consultareventoporid) |
| `/invoices` | ✅ | `restobar_list_invoices` | [consultarfacturas](https://developer.loggro.com/reference/consultarfacturas) |
| `/invoices/validateEInvoice` | 🚫 | Valida ante la DIAN: efecto externo, no es una consulta pura. | [validarfacturaelectronica](https://developer.loggro.com/reference/validarfacturaelectronica) |
| `/invoices/einvoicesCount` | ⏸️ | Conteo de facturas electrónicas; candidato futuro. | [contarfacturaselectronicas](https://developer.loggro.com/reference/contarfacturaselectronicas) |
| `/invoices/currentBusiness/last` | ⏸️ | `restobar_list_invoices` (más reciente primero) lo cubre. | [obtenerultimafactura](https://developer.loggro.com/reference/obtenerultimafactura) |
| `/invoices/currentBusiness/facturadas` | ⏸️ | Estado de facturación electrónica; candidato futuro. | [obtenerfacturadas](https://developer.loggro.com/reference/obtenerfacturadas) |
| `/invoices/{id}` | ✅ | `restobar_get_invoice` | [obtenerfacturaporid](https://developer.loggro.com/reference/obtenerfacturaporid) |
| `/invoices/isValidate/{id}` | 🚫 | Validación de factura electrónica (efecto externo). | [verificarvalidacionfacturaelectronica](https://developer.loggro.com/reference/verificarvalidacionfacturaelectronica) |
| `/invoices/deliveryGuy/myDeliveries` | 🚫 | Vista del rol repartidor. | [obtenermisdomicilios](https://developer.loggro.com/reference/obtenermisdomicilios) |
| `/invoices/deliveryGuy/pending` | 🚫 | Vista del rol repartidor. | [obtenerdomiciliospendientes](https://developer.loggro.com/reference/obtenerdomiciliospendientes) |
| `/orders` | ✅ | `restobar_list_orders` | [consultarpedidos](https://developer.loggro.com/reference/consultarpedidos) |
| `/orders/currentBusiness/espera` | ⏸️ | Pedidos en espera ahora mismo; candidato futuro. | [obtenerpedidosenespera](https://developer.loggro.com/reference/obtenerpedidosenespera) |
| `/orders/tables/{table}` | ⏸️ | `restobar_list_orders` filtra por mesa. | [obtenerpedidospormesa](https://developer.loggro.com/reference/obtenerpedidospormesa) |
| `/orders/tables/status/{status}` | ⏸️ | Vista operativa del POS. | [obtenermesasporestadopedido](https://developer.loggro.com/reference/obtenermesasporestadopedido) |
| `/orders/groups/status/{status}` | ⏸️ | Vista operativa del POS. | [obtenergruposporestadopedido](https://developer.loggro.com/reference/obtenergruposporestadopedido) |
| `/orders/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarpedidoporid](https://developer.loggro.com/reference/consultarpedidoporid) |
| `/orders/kitchen/ordersForKitchen` | 🚫 | Pantalla de cocina (`OR_PUT_KITCHEN`). | [obtenerpedidosparacocina](https://developer.loggro.com/reference/obtenerpedidosparacocina) |
| `/orders/kitchen/espera` | 🚫 | Pantalla de cocina. | [obtenerpedidosenesperacocina](https://developer.loggro.com/reference/obtenerpedidosenesperacocina) |
| `/inventoryInvoicePayments` | ✅ | `restobar_list_purchase_payments` | [consultarpagosinventario](https://developer.loggro.com/reference/consultarpagosinventario) |
| `/inventoryInvoicePayments/inventory/{inventoryId}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarpagosinventariopormovimiento](https://developer.loggro.com/reference/consultarpagosinventariopormovimiento) |
| `/inventoryInvoicePayments/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarpagoinventarioporid](https://developer.loggro.com/reference/consultarpagoinventarioporid) |
| `/paymentMethods` | ✅ | `restobar_list_payment_methods` | [consultarmetodospago](https://developer.loggro.com/reference/consultarmetodospago) |
| `/paymentMethods/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarmetodopagoporid](https://developer.loggro.com/reference/consultarmetodopagoporid) |
| `/taxes` | ✅ | `restobar_list_taxes` | [consultarimpuestos](https://developer.loggro.com/reference/consultarimpuestos) |
| `/taxes/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarimpuestoporid](https://developer.loggro.com/reference/consultarimpuestoporid) |
| `/products` | ✅ | `restobar_list_products` | [consultarproductos](https://developer.loggro.com/reference/consultarproductos) |
| `/products/category/{categoryId}` | ⏸️ | `restobar_list_products` ya filtra por categoría. | [consultarproductosporcategoria](https://developer.loggro.com/reference/consultarproductosporcategoria) |
| `/products/subproducts` | ⏸️ | Variante de `/products`. | [consultarproductosysubproductos](https://developer.loggro.com/reference/consultarproductosysubproductos) |
| `/products/productsMenuProvider/{source}` | 🚫 | Menú para integraciones externas (Rappi…). | [consultarmenuproveedorexterno](https://developer.loggro.com/reference/consultarmenuproveedorexterno) |
| `/products/{id}` | ✅ | `restobar_get_product` | [consultarproductoporid](https://developer.loggro.com/reference/consultarproductoporid) |
| `/reports/reportSalesInvoices` | ⏸️ | Premium; duplica `restobar_list_invoices`. | [reporteventasporfacturas](https://developer.loggro.com/reference/reporteventasporfacturas) |
| `/reports/reportSalesByCategory` | ✅ | `restobar_sales_by_category` (premium) | [reporteventasporcategoria](https://developer.loggro.com/reference/reporteventasporcategoria) |
| `/reports/reportSalesByProduct` | ⏸️ | Cubierto por `restobar_sales_by_product` y `restobar_product_profitability`; la vista por línea es muy pesada. | [reporteventasporproducto](https://developer.loggro.com/reference/reporteventasporproducto) |
| `/reports/reportPurchase` | ✅ | `restobar_purchases_report` (premium) | [reportecomprasinventario](https://developer.loggro.com/reference/reportecomprasinventario) |
| `/reports/reportProduction` | ✅ | `restobar_production_report` (premium) | [reporteproducciones](https://developer.loggro.com/reference/reporteproducciones) |
| `/reports/reportTransfers` | ✅ | `restobar_transfers_report` (premium) | [reportetraslados](https://developer.loggro.com/reference/reportetraslados) |
| `/reports/reportShrinkage` | ✅ | `restobar_shrinkage_report` (premium) | [reportemermas](https://developer.loggro.com/reference/reportemermas) |
| `/reports/reportExpenses` | ⏸️ | Devuelve lo mismo que `/expenses` (verificado: igual número de filas y rango de fechas). | [reportegastos](https://developer.loggro.com/reference/reportegastos) |
| `/reports/reportUtility` | ✅ | `restobar_product_profitability` (premium) | [reporteutilidad](https://developer.loggro.com/reference/reporteutilidad) |
| `/reports/reportUtilityGroupTypes` | ✅ | `restobar_expenses_summary` | [reporteutilidadportiposgasto](https://developer.loggro.com/reference/reporteutilidadportiposgasto) |
| `/reports/reportUtilityDeliveryProvider` | ⏸️ | Responde 200; candidato futuro si se usan domicilios. | [reporteutilidadporproveedorentrega](https://developer.loggro.com/reference/reporteutilidadporproveedorentrega) |
| `/stats/admin` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [getdashboard](https://developer.loggro.com/reference/getdashboard) |
| `/stats/admin/v2` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [getdashboardv2](https://developer.loggro.com/reference/getdashboardv2) |
| `/stats/admin/totalInvoicesCurrentCashBox` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalinvoicescurrentcashbox](https://developer.loggro.com/reference/gettotalinvoicescurrentcashbox) |
| `/stats/admin/lastOrders` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [getlastorders](https://developer.loggro.com/reference/getlastorders) |
| `/stats/admin/totalInvoicesToday` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalinvoicestoday](https://developer.loggro.com/reference/gettotalinvoicestoday) |
| `/stats/admin/totalInvoicesLast7Days` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalinvoiceslast7days](https://developer.loggro.com/reference/gettotalinvoiceslast7days) |
| `/stats/admin/totalInvoicesLast30Days` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalinvoiceslast30days](https://developer.loggro.com/reference/gettotalinvoiceslast30days) |
| `/stats/admin/totalInvoicesCurrentYear` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalinvoicescurrentyear](https://developer.loggro.com/reference/gettotalinvoicescurrentyear) |
| `/stats/admin/totalInvoicesCurrentYear/v2` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalinvoicescurrentyearv2](https://developer.loggro.com/reference/gettotalinvoicescurrentyearv2) |
| `/stats/admin/totalOrdersTodayByHours` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalorderstodaybyhours](https://developer.loggro.com/reference/gettotalorderstodaybyhours) |
| `/stats/admin/totalInvoicesLast7DaysByDays` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalinvoiceslast7daysbydays](https://developer.loggro.com/reference/gettotalinvoiceslast7daysbydays) |
| `/stats/admin/totalOrdersCurrentMonthByProducts` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalorderscurrentmonthbyproducts](https://developer.loggro.com/reference/gettotalorderscurrentmonthbyproducts) |
| `/stats/admin/totalInvoicesCurrentYearByMonth` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalinvoicescurrentyearbymonth](https://developer.loggro.com/reference/gettotalinvoicescurrentyearbymonth) |
| `/stats/admin/totalInvoicesCurrentYearByMonth/v2` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalinvoicescurrentyearbymonthv2](https://developer.loggro.com/reference/gettotalinvoicescurrentyearbymonthv2) |
| `/stats/admin/totalOrdersCurrentMonthBySeller` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalorderscurrentmonthbyseller](https://developer.loggro.com/reference/gettotalorderscurrentmonthbyseller) |
| `/stats/admin/totalOrdersLast24HoursByHours` | ⏸️ | Panel de inicio (`ST_GET_DASHBOARD`): repite con períodos fijos lo que ya dan las estadísticas por período. | [gettotalorderslast24hoursbyhours](https://developer.loggro.com/reference/gettotalorderslast24hoursbyhours) |
| `/stats/totalInvoicesByMonths` | ✅ | `restobar_sales_by_month` | [gettotalinvoicesbymonths](https://developer.loggro.com/reference/gettotalinvoicesbymonths) |
| `/stats/totalInvoicesByDays` | ✅ | `restobar_sales_by_day` (y `restobar_profitability_summary`) | [gettotalinvoicesbydays](https://developer.loggro.com/reference/gettotalinvoicesbydays) |
| `/stats/totalInvoicesByTables` | ✅ | `restobar_sales_by_table` | [gettotalinvoicesbytables](https://developer.loggro.com/reference/gettotalinvoicesbytables) |
| `/stats/totalInvoicesByPaymentMethodPaid` | ✅ | `restobar_sales_by_payment_method` | [gettotalinvoicesbypaymentmethodpaid](https://developer.loggro.com/reference/gettotalinvoicesbypaymentmethodpaid) |
| `/stats/totalInvoicesByProducts` | ✅ | `restobar_sales_by_product` | [gettotalinvoicesbyproducts](https://developer.loggro.com/reference/gettotalinvoicesbyproducts) |
| `/stats/totalInvoicesBySellers` | ✅ | `restobar_sales_by_seller` | [gettotalinvoicesbysellers](https://developer.loggro.com/reference/gettotalinvoicesbysellers) |
| `/stats/totalOrdersGroupByHours` | ✅ | `restobar_orders_by_hour` | [gettotalordersgroupbyhours](https://developer.loggro.com/reference/gettotalordersgroupbyhours) |
| `/stats/totalOrdersGroupByDays` | ✅ | `restobar_orders_by_weekday` | [gettotalordersgroupbydays](https://developer.loggro.com/reference/gettotalordersgroupbydays) |
| `/stats/totalInvoicesByDeliveryProviders` | ✅ | `restobar_sales_by_delivery_provider` | [gettotalinvoicesbydeliveryproviders](https://developer.loggro.com/reference/gettotalinvoicesbydeliveryproviders) |
| `/stats/avgTimeDeliveryGuyDelivered` | ⏸️ | Sin herramienta por ahora. | [getavgtimedeliveryguydelivered](https://developer.loggro.com/reference/getavgtimedeliveryguydelivered) |
| `/stats/totalSalesByBiller` | ✅ | `restobar_sales_by_biller` | [gettotalsalesbybiller](https://developer.loggro.com/reference/gettotalsalesbybiller) |
| `/tables` | ✅ | `restobar_list_tables` (sin `password`) | [consultarmesas](https://developer.loggro.com/reference/consultarmesas) |
| `/tables/tableOrders` | ⏸️ | Estado operativo de mesas en tiempo real; candidato futuro («¿qué mesas están abiertas?»). | [consultarmesasconordenes](https://developer.loggro.com/reference/consultarmesasconordenes) |
| `/tables/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarmesaporid](https://developer.loggro.com/reference/consultarmesaporid) |
| `/units` | ✅ | `restobar_list_units` | [consultarunidades](https://developer.loggro.com/reference/consultarunidades) |
| `/units/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarunidadporid](https://developer.loggro.com/reference/consultarunidadporid) |
| `/providers` | ✅ | `restobar_list_providers` | [consultarproveedores](https://developer.loggro.com/reference/consultarproveedores) |
| `/providers/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarproveedorporid](https://developer.loggro.com/reference/consultarproveedorporid) |
| `/expenses` | ✅ | `restobar_list_expenses` (y `restobar_profitability_summary`) | [consultargastos](https://developer.loggro.com/reference/consultargastos) |
| `/typeExpenses` | ✅ | `restobar_list_expense_types` | [consultartiposgasto](https://developer.loggro.com/reference/consultartiposgasto) |
| `/typeExpenses/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultartipogastoporid](https://developer.loggro.com/reference/consultartipogastoporid) |
| `/cashRegisters` | ⏸️ | Responde 200 pero vacío en el negocio de prueba; poco útil para el modelo. | [consultarcajasregistradoras](https://developer.loggro.com/reference/consultarcajasregistradoras) |
| `/cashRegisters/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarcajaregistradoraporid](https://developer.loggro.com/reference/consultarcajaregistradoraporid) |
| `/cashbox` | ✅ | `restobar_list_cash_closings`. **Ruta real: `/cashboxes`** (la documentada responde «Cannot GET /cashbox»). | [consultarcuadrescaja](https://developer.loggro.com/reference/consultarcuadrescaja) |
| `/promos` | ✅ | `restobar_list_promos` | [consultarpromociones](https://developer.loggro.com/reference/consultarpromociones) |
| `/promos/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarpromocionporid](https://developer.loggro.com/reference/consultarpromocionporid) |
| `/roles` | 🚫 | Roles y permisos internos (`RO_GET_ALL`). | [consultarroles](https://developer.loggro.com/reference/consultarroles) |
| `/roles/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarrolporid](https://developer.loggro.com/reference/consultarrolporid) |
| `/waiterOrderAreas` | ⏸️ | Responde 200 vacío; configuración interna de cocina. | [consultarareaspedido](https://developer.loggro.com/reference/consultarareaspedido) |
| `/waiterOrderAreas/{id}` | 🚫 | Consulta por ID: el listado ya trae el registro y algunas exigen permisos de escritura. | [consultarareapedidoporid](https://developer.loggro.com/reference/consultarareapedidoporid) |
