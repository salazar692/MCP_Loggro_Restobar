import type { AllowedOperation } from '../../http/client.ts';

/**
 * Allowlist de Restobar. Cada entrada debe existir en
 * docs/loggro-api/inventory/restobar.md con clase «lectura» (o «autenticación»
 * para el login); lo verifica tests/contract/restobar-allowlist.test.ts.
 */
/** Consulta GET declarada en la allowlist (id `restobar.<nombre>`). */
function read(name: string, path: string, docSlug: string): AllowedOperation {
  return { id: `restobar.${name}`, kind: 'read', method: 'GET', path, docSlug };
}

export const RESTOBAR_OPERATIONS = {
  login: {
    id: 'restobar.login',
    kind: 'auth',
    method: 'POST',
    path: '/login',
    docSlug: 'iniciarsesion',
  },
  listInvoices: {
    id: 'restobar.listInvoices',
    kind: 'read',
    method: 'GET',
    path: '/invoices',
    docSlug: 'consultarfacturas',
  },
  getInvoice: {
    id: 'restobar.getInvoice',
    kind: 'read',
    method: 'GET',
    path: '/invoices/{id}',
    docSlug: 'obtenerfacturaporid',
  },
  listProducts: {
    id: 'restobar.listProducts',
    kind: 'read',
    method: 'GET',
    path: '/products',
    docSlug: 'consultarproductos',
  },
  listCategories: {
    id: 'restobar.listCategories',
    kind: 'read',
    method: 'GET',
    path: '/categories',
    docSlug: 'consultarcategorias',
  },
  listOrders: {
    id: 'restobar.listOrders',
    kind: 'read',
    method: 'GET',
    path: '/orders',
    docSlug: 'consultarpedidos',
  },
  listClients: {
    id: 'restobar.listClients',
    kind: 'read',
    method: 'GET',
    path: '/clients',
    docSlug: 'consultarclientes',
  },
  listPaymentMethods: {
    id: 'restobar.listPaymentMethods',
    kind: 'read',
    method: 'GET',
    path: '/paymentMethods',
    docSlug: 'consultarmetodospago',
  },
  salesByDay: {
    id: 'restobar.salesByDay',
    kind: 'read',
    method: 'GET',
    path: '/stats/totalInvoicesByDays',
    docSlug: 'gettotalinvoicesbydays',
  },
  // --- Ampliación: gastos, compras, inventario, reportes, estadísticas y configuración ---
  listExpenses: read('listExpenses', '/expenses', 'consultargastos'),
  listExpenseTypes: read('listExpenseTypes', '/typeExpenses', 'consultartiposgasto'),
  listProviders: read('listProviders', '/providers', 'consultarproveedores'),
  listInventoryMovements: read(
    'listInventoryMovements',
    '/inventory',
    'consultarmovimientosinventario',
  ),
  getInventoryMovement: read('getInventoryMovement', '/inventory/{id}', 'consultarmovimientoporid'),
  listInventoryTypes: read(
    'listInventoryTypes',
    '/inventory/types/all',
    'consultartiposinventario',
  ),
  inventoryPurchasesReport: read(
    'inventoryPurchasesReport',
    '/inventory/report/purchases',
    'reportecomprasingredientes',
  ),
  inventoryProductionsReport: read(
    'inventoryProductionsReport',
    '/inventory/report/productions',
    'reporteproduccioningredientes',
  ),
  inventoryTransfersReport: read(
    'inventoryTransfersReport',
    '/inventory/report/transfers',
    'reportetrasladosingredientes',
  ),
  listPurchasePayments: read(
    'listPurchasePayments',
    '/inventoryInvoicePayments',
    'consultarpagosinventario',
  ),
  listIngredients: read('listIngredients', '/ingredients', 'consultaringredientes'),
  getProduct: read('getProduct', '/products/{id}', 'consultarproductoporid'),
  listUnits: read('listUnits', '/units', 'consultarunidades'),
  listTaxes: read('listTaxes', '/taxes', 'consultarimpuestos'),
  listTables: read('listTables', '/tables', 'consultarmesas'),
  listCashRegisters: read('listCashRegisters', '/cashRegisters', 'consultarcajasregistradoras'),
  listCashClosings: read('listCashClosings', '/cashbox', 'consultarcuadrescaja'),
  listDeliveryProviders: read(
    'listDeliveryProviders',
    '/deliveryProviders',
    'consultarproveedoresdomicilio',
  ),
  listPromos: read('listPromos', '/promos', 'consultarpromociones'),
  listOrderAreas: read('listOrderAreas', '/waiterOrderAreas', 'consultarareaspedido'),
  listEvents: read('listEvents', '/events', 'consultareventos'),
  reportSalesByProduct: read(
    'reportSalesByProduct',
    '/reports/reportSalesByProduct',
    'reporteventasporproducto',
  ),
  reportSalesByCategory: read(
    'reportSalesByCategory',
    '/reports/reportSalesByCategory',
    'reporteventasporcategoria',
  ),
  reportPurchases: read('reportPurchases', '/reports/reportPurchase', 'reportecomprasinventario'),
  reportProduction: read('reportProduction', '/reports/reportProduction', 'reporteproducciones'),
  reportTransfers: read('reportTransfers', '/reports/reportTransfers', 'reportetraslados'),
  reportShrinkage: read('reportShrinkage', '/reports/reportShrinkage', 'reportemermas'),
  reportExpenses: read('reportExpenses', '/reports/reportExpenses', 'reportegastos'),
  reportUtility: read('reportUtility', '/reports/reportUtility', 'reporteutilidad'),
  reportUtilityByExpenseType: read(
    'reportUtilityByExpenseType',
    '/reports/reportUtilityGroupTypes',
    'reporteutilidadportiposgasto',
  ),
  reportUtilityByDeliveryProvider: read(
    'reportUtilityByDeliveryProvider',
    '/reports/reportUtilityDeliveryProvider',
    'reporteutilidadporproveedorentrega',
  ),
  salesByMonth: read('salesByMonth', '/stats/totalInvoicesByMonths', 'gettotalinvoicesbymonths'),
  salesByTable: read('salesByTable', '/stats/totalInvoicesByTables', 'gettotalinvoicesbytables'),
  salesByPaymentMethod: read(
    'salesByPaymentMethod',
    '/stats/totalInvoicesByPaymentMethodPaid',
    'gettotalinvoicesbypaymentmethodpaid',
  ),
  salesByProduct: read(
    'salesByProduct',
    '/stats/totalInvoicesByProducts',
    'gettotalinvoicesbyproducts',
  ),
  salesBySeller: read(
    'salesBySeller',
    '/stats/totalInvoicesBySellers',
    'gettotalinvoicesbysellers',
  ),
  salesByBiller: read('salesByBiller', '/stats/totalSalesByBiller', 'gettotalsalesbybiller'),
  salesByDeliveryProvider: read(
    'salesByDeliveryProvider',
    '/stats/totalInvoicesByDeliveryProviders',
    'gettotalinvoicesbydeliveryproviders',
  ),
  ordersByHour: read(
    'ordersByHour',
    '/stats/totalOrdersGroupByHours',
    'gettotalordersgroupbyhours',
  ),
  ordersByWeekday: read(
    'ordersByWeekday',
    '/stats/totalOrdersGroupByDays',
    'gettotalordersgroupbydays',
  ),
} as const satisfies Record<string, AllowedOperation>;

export const RESTOBAR_ALLOWLIST: readonly AllowedOperation[] = Object.values(RESTOBAR_OPERATIONS);
