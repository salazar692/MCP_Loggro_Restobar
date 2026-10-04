/**
 * Prueba de humo contra la API REAL de Restobar, pensada para negocios en
 * producción. Garantías (independientes del código del servidor):
 *
 * - Nunca hace login. El token llega de una de dos formas:
 *   a) LOGGRO_RESTOBAR_TOKEN definida: se envía en la cabecera Authorization.
 *   b) Sin credenciales en el entorno: se asume una credencial del entorno de
 *      Claude Code en la nube, que el proxy agrega a las solicitudes hacia
 *      api.pirpos.com. El token nunca está en esta máquina ni se envía cabecera.
 * - Un `fetch` guardián bloquea, ANTES de la red, cualquier método distinto de
 *   GET y cualquier host distinto del configurado.
 * - Presupuesto de solicitudes por herramienta (máximo 5, acumulado entre
 *   ejecuciones en .cache/restobar-smoke-ledger.json). Sin reintentos.
 * - Imprime solo tipos, conteos y fechas técnicas; nunca nombres, documentos,
 *   teléfonos ni montos.
 * - El resumen y la exportación de clientes solo se ejecutan si el total de
 *   clientes cabe en el presupuesto; el archivo exportado se verifica y se borra.
 *
 * Uso: node --env-file=.env scripts/smoke-restobar.ts [herramienta ...]
 *      NODE_USE_ENV_PROXY=1 node scripts/smoke-restobar.ts [herramienta ...]   (nube, detrás de proxy)
 * Con SMOKE_RAW_SHAPE=1 imprime además los campos y tipos de la respuesta cruda (sin valores),
 * combinando todos los elementos. SMOKE_INVOICE_ID=<id> fija la factura de restobar_get_invoice.
 * SMOKE_HEADERS=1 imprime los nombres de las cabeceras de respuesta (sin valores) y su codificación.
 * Con SMOKE_PROBE=1 no usa herramientas: consulta directamente las operaciones de PROBES (o las
 * nombradas como argumento) e imprime estado, conteo y rango de fechas (con SMOKE_RAW_SHAPE=1, también
 * la forma cruda). Cada
 * operación tiene su propio presupuesto (`probe:<operación>`).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { loadConfig } from '../src/config.ts';
import { HttpClient, type AllowedOperation } from '../src/http/client.ts';
import { StaticTokenProvider } from '../src/loggro/restobar/auth.ts';
import { RestobarClient } from '../src/loggro/restobar/client.ts';
import { RESTOBAR_ALLOWLIST, RESTOBAR_OPERATIONS } from '../src/loggro/restobar/operations.ts';
import { silentLogger } from '../src/logging.ts';
import { createServer } from '../src/server.ts';
import { BULK_PAGE_SIZE } from '../src/tools/restobar/clients-bulk.ts';
import { dayRangeToIso } from '../src/tools/shared.ts';

// SMOKE_MAX_REQUESTS y SMOKE_LEDGER permiten una ronda aparte con su propio tope, sin tocar el historial.
const MAX_REQUESTS_PER_TOOL = Number(process.env.SMOKE_MAX_REQUESTS ?? 5);
// Con SMOKE_RAW_SHAPE=1 conviene ver más registros por solicitud (el costo es el mismo).
const PAGE_SIZE = process.env.SMOKE_RAW_SHAPE === '1' ? 50 : 2;
const LEDGER = path.resolve(
  import.meta.dirname,
  '../.cache',
  process.env.SMOKE_LEDGER ?? 'restobar-smoke-ledger.json',
);

type Args = Record<string, unknown>;
interface Step {
  tool: string;
  /** Argumentos, o el motivo para omitir el paso. */
  args: (memory: Memory, remaining: number) => Args | string;
  note?: string;
}
interface Memory {
  invoiceId?: string;
  productId?: string;
  clientsTotal?: number | null;
}

/** Resumen y exportación descargan todos los clientes: solo si caben en el presupuesto. */
function allClients(m: Memory, remaining: number): Args | string {
  if (m.clientsTotal === undefined)
    return 'falta el total de clientes (requiere restobar_list_clients)';
  if (m.clientsTotal === null) return 'Restobar no informó el total de clientes';
  const needed = Math.max(1, Math.ceil(m.clientsTotal / BULK_PAGE_SIZE));
  return needed <= remaining
    ? {}
    : `${m.clientsTotal} clientes requieren ${needed} solicitudes y el presupuesto restante es ${remaining}`;
}

// Valores que se imprimen tal cual: conteos, nunca datos de personas.
const SAFE_VALUES = new Set([
  'clients',
  'reportedTotal',
  'complete',
  'rows',
  'personalDataIncluded',
  'restobarRequests',
]);

function yesterdayInBogota(): string {
  const now = new Date(Date.now() - 5 * 3_600_000); // Colombia: UTC−5 sin horario de verano
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}

function daysAgoInBogota(days: number): string {
  const d = new Date(Date.now() - 5 * 3_600_000);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Período de los reportes en la prueba: los últimos 7 días completos. */
const lastWeek = (): Args => ({ dateFrom: daysAgoInBogota(7), dateTo: yesterdayInBogota() });

const PLAN: Step[] = [
  { tool: 'restobar_list_invoices', args: () => ({ pageSize: PAGE_SIZE }), note: 'recientes' },
  {
    tool: 'restobar_list_invoices',
    args: () => ({ dateFrom: yesterdayInBogota(), dateTo: yesterdayInBogota(), pageSize: 3 }),
    note: 'ayer (verifica zona horaria)',
  },
  {
    tool: 'restobar_get_invoice',
    args: (m) => (m.invoiceId ? { id: m.invoiceId } : 'falta una factura del paso anterior'),
  },
  { tool: 'restobar_list_products', args: () => ({ pageSize: PAGE_SIZE }) },
  { tool: 'restobar_list_categories', args: () => ({}) },
  { tool: 'restobar_list_payment_methods', args: () => ({}) },
  { tool: 'restobar_list_orders', args: () => ({ pageSize: PAGE_SIZE }) },
  { tool: 'restobar_list_clients', args: () => ({ pageSize: PAGE_SIZE }) },
  { tool: 'restobar_clients_summary', args: allClients },
  { tool: 'restobar_export_clients', args: allClients, note: 'archivo temporal que se borra' },
  {
    tool: 'restobar_sales_by_day',
    args: () => ({ dateFrom: daysAgoInBogota(7), dateTo: yesterdayInBogota() }),
  },
  // Ampliación: reportes, estadísticas, gastos, compras, inventario y configuración (últimos 7 días).
  ...[
    'restobar_list_expenses',
    'restobar_expenses_summary',
    'restobar_purchases_report',
    'restobar_list_purchase_payments',
    'restobar_production_report',
    'restobar_transfers_report',
    'restobar_shrinkage_report',
    'restobar_sales_by_product',
    'restobar_sales_by_payment_method',
    'restobar_sales_by_seller',
    'restobar_sales_by_table',
    'restobar_sales_by_month',
    'restobar_sales_by_delivery_provider',
    'restobar_sales_by_biller',
    'restobar_orders_by_hour',
    'restobar_orders_by_weekday',
    'restobar_sales_by_category',
    'restobar_product_profitability',
    'restobar_profitability_summary',
  ].map((tool) => ({ tool, args: lastWeek })),
  { tool: 'restobar_list_expense_types', args: () => ({}) },
  { tool: 'restobar_list_providers', args: () => ({}) },
  { tool: 'restobar_list_ingredients', args: () => ({ pageSize: PAGE_SIZE }) },
  {
    tool: 'restobar_get_product',
    args: (m) =>
      m.productId ? { id: m.productId } : 'falta un producto de restobar_list_products',
  },
  { tool: 'restobar_list_tables', args: () => ({}) },
  { tool: 'restobar_list_taxes', args: () => ({}) },
  { tool: 'restobar_list_units', args: () => ({}) },
  { tool: 'restobar_list_promos', args: () => ({}) },
  { tool: 'restobar_list_cash_closings', args: () => ({ pageSize: PAGE_SIZE }) },
  {
    tool: 'restobar_list_cash_closings',
    args: () => ({ status: 'closed', ...lastWeek() }),
    note: 'cerrados, últimos 7 días',
  },
  { tool: 'restobar_list_inventory_movements', args: () => ({ pageSize: PAGE_SIZE }) },
  { tool: 'restobar_list_inventory_types', args: () => ({}) },
  { tool: 'restobar_list_delivery_providers', args: () => ({}) },
];

type ProbeQuery = Record<string, string | number | boolean>;
type Probe = [name: string, op: AllowedOperation, query: ProbeQuery];

/**
 * Rutas solo para diagnosticar endpoints documentados que responden 404 (p. ej. cuadres de caja):
 * variantes de mayúsculas, plural y barra final, y endpoints relacionados. Todas GET; no forman parte
 * de la allowlist del servidor.
 */
const diag = (name: string, path: string, docSlug: string): AllowedOperation => ({
  id: `diagnostic.${name}`,
  kind: 'read',
  method: 'GET',
  path,
  docSlug,
});
const DIAGNOSTIC_OPS = {
  cashbox: diag('cashbox', '/cashbox', 'consultarcuadrescaja'),
  cashboxSlash: diag('cashboxSlash', '/cashbox/', 'consultarcuadrescaja'),
  cashBox: diag('cashBox', '/cashBox', 'consultarcuadrescaja'),
  cashboxes: diag('cashboxes', '/cashboxes', 'consultarcuadrescaja'),
  cashBoxes: diag('cashBoxes', '/cashBoxes', 'consultarcuadrescaja'),
  currentCashBoxTotal: diag(
    'currentCashBoxTotal',
    '/stats/admin/totalInvoicesCurrentCashBox',
    'gettotalinvoicescurrentcashbox',
  ),
  inventory: diag('inventory', '/inventory', 'consultarmovimientosinventario'),
  deliveryProviders: diag(
    'deliveryProviders',
    '/deliveryProviders',
    'consultarproveedoresdomicilio',
  ),
  inventories: diag('inventories', '/inventories', 'consultarmovimientosinventario'),
  inventoriesTypes: diag('inventoriesTypes', '/inventories/types/all', 'consultartiposinventario'),
  inventoriesPurchases: diag(
    'inventoriesPurchases',
    '/inventories/report/purchases',
    'reportecomprasingredientes',
  ),
  deliveryProvider: diag('deliveryProvider', '/deliveryProvider', 'consultarproveedoresdomicilio'),
} satisfies Record<string, AllowedOperation>;

/** Últimos 7 días completos (hasta ayer) en hora de Colombia, como instantes ISO. */
function lastWeekIso(): { start: string; end: string } {
  const { start, end } = dayRangeToIso(daysAgoInBogota(7), yesterdayInBogota(), 'America/Bogota');
  return { start: start ?? '', end: end ?? '' };
}

/** Operaciones a sondear y su consulta: fechas en los dos nombres que usa Restobar según el endpoint. */
function probes(): Probe[] {
  const { start, end } = lastWeekIso();
  const iso = { dateInitISO: start, dateEndISO: end };
  const plain = { dateInit: start, dateEnd: end };
  const paged = { pagination: true, limit: 5, page: 0 };
  return [
    ['listExpenses', RESTOBAR_OPERATIONS.listExpenses, plain],
    ['reportExpenses', RESTOBAR_OPERATIONS.reportExpenses, plain],
    ['listExpenseTypes', RESTOBAR_OPERATIONS.listExpenseTypes, {}],
    ['listProviders', RESTOBAR_OPERATIONS.listProviders, {}],
    ['listInventoryMovements', RESTOBAR_OPERATIONS.listInventoryMovements, paged],
    ['listInventoryTypes', RESTOBAR_OPERATIONS.listInventoryTypes, {}],
    ['listPurchasePayments', RESTOBAR_OPERATIONS.listPurchasePayments, {}],
    ['reportPurchases', RESTOBAR_OPERATIONS.reportPurchases, iso],
    ['reportProduction', RESTOBAR_OPERATIONS.reportProduction, iso],
    ['reportTransfers', RESTOBAR_OPERATIONS.reportTransfers, iso],
    ['reportShrinkage', RESTOBAR_OPERATIONS.reportShrinkage, iso],
    ['reportUtility', RESTOBAR_OPERATIONS.reportUtility, { ...iso, groupResult: true }],
    ['reportUtilityByExpenseType', RESTOBAR_OPERATIONS.reportUtilityByExpenseType, iso],
    ['reportUtilityByDeliveryProvider', RESTOBAR_OPERATIONS.reportUtilityByDeliveryProvider, iso],
    [
      'reportSalesByProduct',
      RESTOBAR_OPERATIONS.reportSalesByProduct,
      { ...iso, groupResult: true },
    ],
    ['reportSalesByCategory', RESTOBAR_OPERATIONS.reportSalesByCategory, iso],
    ['salesByMonth', RESTOBAR_OPERATIONS.salesByMonth, iso],
    ['salesByTable', RESTOBAR_OPERATIONS.salesByTable, iso],
    ['salesByPaymentMethod', RESTOBAR_OPERATIONS.salesByPaymentMethod, iso],
    ['salesByProduct', RESTOBAR_OPERATIONS.salesByProduct, iso],
    ['salesBySeller', RESTOBAR_OPERATIONS.salesBySeller, iso],
    ['salesByBiller', RESTOBAR_OPERATIONS.salesByBiller, iso],
    ['salesByDeliveryProvider', RESTOBAR_OPERATIONS.salesByDeliveryProvider, iso],
    ['ordersByHour', RESTOBAR_OPERATIONS.ordersByHour, iso],
    ['ordersByWeekday', RESTOBAR_OPERATIONS.ordersByWeekday, iso],
    ['listIngredients', RESTOBAR_OPERATIONS.listIngredients, paged],
    ['listUnits', RESTOBAR_OPERATIONS.listUnits, {}],
    ['listTaxes', RESTOBAR_OPERATIONS.listTaxes, {}],
    ['listTables', RESTOBAR_OPERATIONS.listTables, {}],
    ['listCashRegisters', RESTOBAR_OPERATIONS.listCashRegisters, {}],
    ['listCashClosings', RESTOBAR_OPERATIONS.listCashClosings, { ...paged, ...plain }],
    ['listDeliveryProviders', RESTOBAR_OPERATIONS.listDeliveryProviders, {}],
    ['listPromos', RESTOBAR_OPERATIONS.listPromos, {}],
    ['listOrderAreas', RESTOBAR_OPERATIONS.listOrderAreas, {}],
    ['listEvents', RESTOBAR_OPERATIONS.listEvents, { limit: 5 }],
    // Diagnóstico de cuadres de caja: ejemplo de la documentación, sin parámetros, por estado, variantes de
    // ruta y el total de la caja actual. Más los otros 404, sin parámetros, para comparar el error.
    ['cashbox:ejemploDoc', DIAGNOSTIC_OPS.cashbox, { pagination: true, limit: 20, page: 0 }],
    ['cashbox:sinParametros', DIAGNOSTIC_OPS.cashbox, {}],
    ['cashbox:abiertos', DIAGNOSTIC_OPS.cashbox, { status: 'open' }],
    ['cashbox:cerrados', DIAGNOSTIC_OPS.cashbox, { status: 'closed' }],
    ['cashbox:barraFinal', DIAGNOSTIC_OPS.cashboxSlash, {}],
    ['cashbox:cashBox', DIAGNOSTIC_OPS.cashBox, {}],
    ['cashbox:cashboxes', DIAGNOSTIC_OPS.cashboxes, {}],
    ['cashbox:cashBoxes', DIAGNOSTIC_OPS.cashBoxes, {}],
    ['cashbox:totalCajaActual', DIAGNOSTIC_OPS.currentCashBoxTotal, {}],
    ['cashboxes:paginado', DIAGNOSTIC_OPS.cashboxes, { pagination: true, limit: 2, page: 0 }],
    [
      'cashboxes:cerradosSemana',
      DIAGNOSTIC_OPS.cashboxes,
      { pagination: true, limit: 50, page: 0, status: 'closed', ...plain },
    ],
    // Límites: ¿qué hace la API por encima del máximo documentado (productos: 100) y con parámetros
    // de paginación en un endpoint que no pagina (categorías)?
    [
      'limite:productos101',
      RESTOBAR_OPERATIONS.listProducts,
      { pagination: true, limit: 101, page: 0 },
    ],
    [
      'limite:productos20',
      RESTOBAR_OPERATIONS.listProducts,
      { pagination: true, limit: 20, page: 0 },
    ],
    [
      'limite:categoriasPaginadas',
      RESTOBAR_OPERATIONS.listCategories,
      { pagination: true, limit: 5, page: 0 },
    ],
    ['inventory:sinParametros', DIAGNOSTIC_OPS.inventory, {}],
    ['inventories:paginado', DIAGNOSTIC_OPS.inventories, paged],
    ['inventories:tipos', DIAGNOSTIC_OPS.inventoriesTypes, {}],
    ['inventories:compras', DIAGNOSTIC_OPS.inventoriesPurchases, iso],
    ['deliveryProvider:singular', DIAGNOSTIC_OPS.deliveryProvider, {}],
    ['deliveryProviders:sinParametros', DIAGNOSTIC_OPS.deliveryProviders, {}],
  ];
}

/** Rango de fechas (ISO o YYYY-MM-DD) presente en una respuesta; las fechas no son datos personales. */
function dateSpan(value: unknown): string {
  const found: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) found.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach(walk);
  };
  walk(value);
  if (!found.length) return 'sin fechas';
  found.sort();
  return `${found[0]} → ${found.at(-1)} (${found.length} fechas)`;
}

function count(value: unknown): string {
  if (Array.isArray(value)) return `arreglo de ${value.length}`;
  if (typeof value === 'object' && value !== null) {
    return (
      Object.entries(value)
        .map(([k, v]) =>
          Array.isArray(v)
            ? `${k}: ${v.length}`
            : typeof v === 'number' && k === 'count'
              ? `count: ${v}`
              : null,
        )
        .filter(Boolean)
        .join(', ') || 'objeto'
    );
  }
  return typeof value;
}

/** Describe la forma de un valor sin revelarlo. */
function shape(value: unknown, depth = 0): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'array(0)' : [`array(${value.length})`, shape(value[0], depth + 1)];
  }
  if (typeof value === 'object' && depth < 4) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]));
  }
  return typeof value;
}

type RawShape = string | { [key: string]: RawShape } | { '[]': RawShape };

/**
 * Campos y tipos de una respuesta cruda, combinando TODOS los elementos de cada arreglo: un campo
 * vacío en el primero no oculta su tipo real. Tipos distintos se unen con «|». Nunca incluye valores.
 */
function rawShape(value: unknown, depth = 0, key = ''): RawShape {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array(0)';
    return { '[]': value.map((v) => rawShape(v, depth + 1, key)).reduce(mergeShape) };
  }
  if (typeof value === 'object') {
    if (depth >= 6) return 'object';
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rawShape(v, depth + 1, k)]),
    );
  }
  if (typeof value === 'string') return stringFormat(key, value);
  if (typeof value === 'number') return Number.isInteger(value) ? 'number:int' : 'number:dec';
  return typeof value;
}

// Campos de catálogo (estados, tipos): se muestran sus valores, que no son datos de personas.
const ENUM_KEYS = new Set([
  'status',
  'type',
  'printType',
  'timeZone',
  'inventoryType',
  'documentName',
  'countryCode',
  'typePersona',
  'role',
]);

/** Formato de un texto sin revelarlo (salvo campos de catálogo). */
function stringFormat(key: string, v: string): string {
  if (ENUM_KEYS.has(key) && v.length <= 40) return `enum:${v}`;
  if (v === '') return 'string:vacío';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    return v.endsWith('Z') ? 'string:iso-utc' : 'string:iso-offset';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'string:fecha';
  if (/^[0-9a-f]{24}$/.test(v)) return 'string:objectId';
  if (/^[0-9a-f-]{36}$/i.test(v)) return 'string:uuid';
  if (/^\d+$/.test(v)) return 'string:dígitos';
  if (/^https?:\/\//.test(v)) return 'string:url';
  return 'string:texto';
}

function mergeShape(a: RawShape, b: RawShape): RawShape {
  if (typeof a === 'string' && typeof b === 'string') {
    return [...new Set([...a.split('|'), ...b.split('|')])].sort().join('|');
  }
  if (typeof a === 'string' || typeof b === 'string') {
    // Objeto en unos elementos y primitivo en otros: se conserva el objeto y se anotan los demás.
    const [obj, prim] = typeof a === 'string' ? [b, a] : [a, b as string];
    const tag = (obj as Record<string, RawShape>)['(también)'];
    return {
      ...(obj as Record<string, RawShape>),
      '(también)': typeof tag === 'string' ? mergeShape(tag, prim) : prim,
    };
  }
  const out: Record<string, RawShape> = { ...(a as Record<string, RawShape>) };
  for (const [k, v] of Object.entries(b)) {
    out[k] = k in out ? mergeShape(out[k] as RawShape, v) : mergeShape(v, 'ausente');
  }
  for (const k of Object.keys(out))
    if (!(k in b)) out[k] = mergeShape(out[k] as RawShape, 'ausente');
  return out;
}

/** Para listas: cuántos elementos traen cada campo con valor (sin mostrarlo). */
function fill(items: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    for (const [k, v] of Object.entries(item)) {
      const [have = 0] = (out[k] ?? '0').split('/').map(Number);
      out[k] = `${have + (v === null ? 0 : 1)}/${items.length}`;
    }
  }
  return out;
}

function describeResult(tool: string, structured: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(structured)) {
    if (key === 'pagination') {
      console.log('  pagination:', JSON.stringify(value));
    } else if (Array.isArray(value)) {
      console.log(`  ${key}: ${value.length} elementos`);
      if (value.length) console.log('  tipos:', JSON.stringify(shape(value[0])));
      if (value.length) console.log('  campos con dato:', JSON.stringify(fill(value)));
      if (tool === 'restobar_list_invoices' && value.length) {
        const dates = value
          .map((v) => (v as { createdOn?: string | null }).createdOn)
          .filter((d): d is string => typeof d === 'string')
          .sort();
        console.log('  createdOn (rango):', dates[0], '→', dates.at(-1));
      }
      if (tool === 'restobar_sales_by_day') {
        console.log(
          '  fechas:',
          value.map((v) => (v as { date?: string | null }).date),
        );
      }
    } else if (typeof value === 'object' && value !== null) {
      console.log(`  ${key}:`, JSON.stringify(shape(value)));
    } else if (SAFE_VALUES.has(key)) {
      console.log(`  ${key}: ${String(value)}`);
    } else {
      console.log(`  ${key}: ${typeof value}`);
    }
  }
}

function describeToken(token: string): void {
  const payload = token.split('.')[1];
  if (!payload) return console.log('Token: no es un JWT; no se puede leer su vigencia.');
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iat?: number;
      exp?: number;
    };
    const iat = claims.iat ? new Date(claims.iat * 1000).toISOString() : '¿?';
    const exp = claims.exp ? new Date(claims.exp * 1000).toISOString() : 'sin expiración';
    const days = claims.iat && claims.exp ? ((claims.exp - claims.iat) / 86_400).toFixed(2) : '¿?';
    console.log(`Token: emitido ${iat}, expira ${exp}, vigencia ${days} días (solo fechas).`);
  } catch {
    console.log('Token: no se pudo leer la vigencia.');
  }
}

async function main(): Promise<void> {
  const env = process.env;
  // El `fetch` de Node ignora HTTPS_PROXY salvo con NODE_USE_ENV_PROXY=1. En la nube, el proxy es
  // quien pone el token real: sin él Restobar recibe el marcador y responde 403.
  if ((env.HTTPS_PROXY || env.https_proxy) && env.NODE_USE_ENV_PROXY !== '1') {
    throw new Error(
      'Hay HTTPS_PROXY pero falta NODE_USE_ENV_PROXY=1: no se envió ninguna solicitud.',
    );
  }
  const injected =
    !env.LOGGRO_RESTOBAR_TOKEN && !env.LOGGRO_RESTOBAR_EMAIL && !env.LOGGRO_RESTOBAR_PASSWORD;
  // Con credencial del entorno el valor es un marcador: nunca se envía (ver token más abajo).
  const config = loadConfig(
    injected ? { ...env, LOGGRO_RESTOBAR_TOKEN: 'credencial-del-entorno' } : env,
  );
  const auth = config.restobar.auth;
  if (auth.mode !== 'token') {
    throw new Error(
      'La prueba de humo nunca hace login y prueba una sola cuenta: usa LOGGRO_RESTOBAR_TOKEN.',
    );
  }
  const token = injected ? '' : auth.token;
  if (injected) {
    console.log(
      'Credencial: la agrega el entorno a las solicitudes hacia la API (el token no está en esta máquina).',
    );
  } else {
    describeToken(token);
  }

  const only = new Set(process.argv.slice(2));
  const plan = only.size ? PLAN.filter((s) => only.has(s.tool)) : PLAN;
  const ledger = JSON.parse(await readFile(LEDGER, 'utf8').catch(() => '{}')) as Record<
    string,
    number
  >;
  const allowedHost = new URL(config.restobar.baseUrl).host;
  let currentTool = '';

  const block = (reason: string): never => {
    console.log(`  BLOQUEADO antes de la red: ${reason}`);
    throw new Error(`BLOQUEADO: ${reason}`);
  };
  const guardedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') block(`método ${method} no permitido`);
    if (url.host !== allowedHost) block(`host ${url.host} no permitido`);
    const used = ledger[currentTool] ?? 0;
    if (used >= MAX_REQUESTS_PER_TOOL) {
      block(`${currentTool} ya usó ${used} solicitudes (máximo ${MAX_REQUESTS_PER_TOOL})`);
    }
    ledger[currentTool] = used + 1;
    console.log(`  → GET ${url.pathname} (solicitud ${used + 1}/${MAX_REQUESTS_PER_TOOL})`);
    const res = await fetch(url, init);
    const bytes = (await res.clone().arrayBuffer()).byteLength;
    console.log(`  ← HTTP ${res.status}, ${(bytes / 1024).toFixed(1)} KB`);
    if (process.env.SMOKE_HEADERS === '1') {
      // Solo nombres de cabeceras (sin valores), más codificación y si algún valor trae bytes no ASCII:
      // sirve para comparar respuestas que un runtime distinto podría rechazar.
      const names = [...res.headers.keys()].sort().join(', ');
      const nonAscii = [...res.headers].filter(([, v]) => /[^\x20-\x7e]/.test(v)).map(([k]) => k);
      console.log(`  cabeceras: ${names}`);
      console.log(
        `  content-encoding: ${res.headers.get('content-encoding') ?? '—'}; transfer-encoding: ${res.headers.get('transfer-encoding') ?? '—'}; valores no ASCII en: ${nonAscii.join(', ') || 'ninguno'}`,
      );
    }
    if (process.env.SMOKE_PROBE === '1' && !res.ok && bytes < 1024) {
      // Cuerpo corto del error (p. ej. «Cannot GET /x» o un mensaje JSON), con los números enmascarados.
      const text = (await res.clone().text()).replace(/\s+/g, ' ').replace(/\d{3,}/g, '###');
      console.log(`  cuerpo del error: ${text.slice(0, 200)}`);
    }
    if (process.env.SMOKE_RAW_SHAPE === '1' && res.ok) {
      // Campos y tipos de la respuesta cruda (sin valores): contrasta la API con schemas.ts.
      const raw: unknown = await res
        .clone()
        .json()
        .catch(() => null);
      console.log('  crudo:', JSON.stringify(rawShape(raw), null, 1));
    }
    return res;
  };
  const exportDir = await mkdtemp(path.join(tmpdir(), 'mcp-loggro-smoke-'));

  const http = new HttpClient({
    baseUrl: config.restobar.baseUrl,
    allowlist: [...RESTOBAR_ALLOWLIST, ...Object.values(DIAGNOSTIC_OPS)],
    fetch: guardedFetch,
    maxRetries: 0,
    logger: silentLogger,
  });

  if (env.SMOKE_PROBE === '1') {
    const selected = probes().filter(([name]) => !only.size || only.has(name));
    try {
      for (const [name, op, query] of selected) {
        currentTool = `probe:${name}`;
        const params = Object.keys(query).join(', ') || 'sin parámetros';
        console.log(`\n# ${name} (${op.path}; ${params})`);
        if ((ledger[currentTool] ?? 0) >= MAX_REQUESTS_PER_TOOL) {
          console.log('  omitida: presupuesto de solicitudes agotado');
          continue;
        }
        try {
          const body = await http.request(op, { query, token });
          console.log(`  OK: ${count(body)}; fechas: ${dateSpan(body)}`);
        } catch (err) {
          const status = (err as { status?: number }).status;
          const msg = (err as { apiMessage?: string }).apiMessage ?? (err as Error).message;
          console.log(`  ERROR${status ? ` HTTP ${status}` : ''}: ${msg}`);
        }
      }
    } finally {
      await mkdir(path.dirname(LEDGER), { recursive: true });
      await writeFile(LEDGER, JSON.stringify(ledger, null, 2));
      console.log('\nSolicitudes acumuladas:', JSON.stringify(ledger));
      await rm(exportDir, { recursive: true, force: true });
    }
    return;
  }
  const server = createServer({
    // Token vacío: el cliente HTTP no envía la cabecera Authorization.
    restobar: new RestobarClient(http, new StaticTokenProvider(token)),
    redactPersonalData: config.redactPersonalData,
    timeZone: config.timeZone,
    exportDir,
    logger: silentLogger,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'smoke', version: '0' });
  await client.connect(clientTransport);

  // SMOKE_INVOICE_ID permite probar restobar_get_invoice sin gastar una solicitud de la lista.
  const memory: Memory = { invoiceId: process.env.SMOKE_INVOICE_ID || undefined };
  try {
    for (const step of plan) {
      const remaining = MAX_REQUESTS_PER_TOOL - (ledger[step.tool] ?? 0);
      const args = step.args(memory, remaining);
      console.log(`\n# ${step.tool}${step.note ? ` (${step.note})` : ''}`);
      if (typeof args === 'string') {
        console.log(`  omitida: ${args}`);
        continue;
      }
      if (remaining <= 0) {
        console.log('  omitida: presupuesto de solicitudes agotado');
        continue;
      }
      currentTool = step.tool;
      const result = await client.callTool({ name: step.tool, arguments: args });
      const structured = result.structuredContent as Record<string, unknown> | undefined;
      if (result.isError || !structured) {
        const content = result.content as { text?: string }[] | undefined;
        console.log('  ERROR:', content?.[0]?.text ?? 'sin detalle');
        continue;
      }
      console.log('  OK');
      describeResult(step.tool, structured);
      const invoices = structured.invoices as { id?: string }[] | undefined;
      memory.invoiceId ??= invoices?.[0]?.id;
      const products = structured.products as { id?: string }[] | undefined;
      if (step.tool === 'restobar_list_products') memory.productId ??= products?.[0]?.id;
      if (step.tool === 'restobar_list_clients') {
        memory.clientsTotal = (structured.pagination as { total: number | null }).total;
      }
      if (typeof structured.file === 'string') {
        const file = await readFile(structured.file);
        const isZip = file.subarray(0, 2).toString('latin1') === 'PK';
        console.log(`  archivo: ${(file.length / 1024).toFixed(1)} KB, formato ZIP/XLSX: ${isZip}`);
      }
    }
  } finally {
    await mkdir(path.dirname(LEDGER), { recursive: true });
    await writeFile(LEDGER, JSON.stringify(ledger, null, 2));
    console.log('\nSolicitudes acumuladas por herramienta:', JSON.stringify(ledger));
    await client.close();
    await rm(exportDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
