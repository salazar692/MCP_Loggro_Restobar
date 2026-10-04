import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { HttpClient } from '../../src/http/client.ts';
import { StaticTokenProvider } from '../../src/loggro/restobar/auth.ts';
import { RestobarClient } from '../../src/loggro/restobar/client.ts';
import { RESTOBAR_ALLOWLIST } from '../../src/loggro/restobar/operations.ts';
import { silentLogger } from '../../src/logging.ts';
import { createServer } from '../../src/server.ts';
import { fakeFetch, type FakeResponse, type RecordedRequest } from '../helpers/fake-fetch.ts';

/*
 * Herramientas de gastos, compras, inventario, reportes, estadísticas y configuración. Los datos son
 * ficticios; las formas siguen la documentación oficial y las variantes que Restobar usa en la
 * práctica (referencias como ID o pobladas, etiquetas dentro de `_id`, respuestas envueltas).
 */

const PERIOD = { dateFrom: '2026-09-26', dateTo: '2026-10-02' };

async function connect(handler: (req: RecordedRequest) => FakeResponse, redact = false) {
  const fake = fakeFetch(handler);
  const http = new HttpClient({
    baseUrl: 'https://api.pirpos.test',
    allowlist: RESTOBAR_ALLOWLIST,
    fetch: fake.fetch,
    sleep: () => Promise.resolve(),
  });
  const server = createServer({
    restobar: new RestobarClient(http, new StaticTokenProvider('tok')),
    redactPersonalData: redact,
    timeZone: 'America/Bogota',
    exportDir: null,
    logger: silentLogger,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return result as {
      isError?: boolean;
      structuredContent?: unknown;
      content: { text: string }[];
    };
  };
  return { call, calls: fake.calls };
}

/** Valor en la ruta `a.b.0.c` de la salida estructurada (sin tipos: lo validan las aserciones). */
function pick(result: { structuredContent?: unknown }, path: string): unknown {
  let cur: unknown = result.structuredContent;
  for (const key of path.split('.')) {
    cur =
      typeof cur === 'object' && cur !== null ? (cur as Record<string, unknown>)[key] : undefined;
  }
  return cur;
}

/** Responde según la ruta; 404 para cualquier otra. */
const byPath =
  (routes: Record<string, FakeResponse>) =>
  (req: RecordedRequest): FakeResponse =>
    routes[req.url.pathname] ?? { status: 404, body: { message: 'Not found' } };

describe('gastos y compras', () => {
  it('restobar_list_expenses: período, tipos por ID, borrados fuera y totales', async () => {
    const { call, calls } = await connect(
      byPath({
        '/expenses': {
          body: [
            {
              _id: 'e1',
              typeExpense: 't1',
              paidTo: 'Persona Demo',
              provider: { _id: 'p1', name: 'Proveedor Demo' },
              paymentMethod: 'Efectivo',
              description: 'Hielo',
              subTotal: 10000,
              taxes: 1900,
              subtractCashRegister: true,
              date: '2026-09-29T15:00:00.000Z',
            },
            { _id: 'e2', typeExpense: 't2', subTotal: 5000, date: '2026-09-30T15:00:00.000Z' },
            { _id: 'e3', typeExpense: 't1', subTotal: 999, deletedInfo: { isDeleted: true } },
          ],
        },
        '/typeExpenses': {
          body: [
            { _id: 't1', name: 'Insumos' },
            { _id: 't2', name: 'Servicios' },
          ],
        },
      }),
    );
    const r = await call('restobar_list_expenses', PERIOD);
    expect(r.isError).toBeFalsy();
    expect(pick(r, 'expenses')).toHaveLength(2);
    expect(pick(r, 'expenses.0')).toMatchObject({
      expenseType: 'Insumos',
      provider: 'Proveedor Demo',
      paidTo: 'Persona Demo',
      total: 11900,
      subtractedFromCashRegister: true,
    });
    expect(pick(r, 'totals')).toEqual({ count: 2, subTotal: 15000, taxes: 1900, total: 16900 });
    expect(pick(r, 'byExpenseType.0')).toEqual({ expenseType: 'Insumos', count: 1, total: 11900 });
    const expensesCall = calls.find((c) => c.url.pathname === '/expenses');
    // 26-sep 00:00 y 02-oct 23:59:59.999 en Bogotá (UTC−5).
    expect(expensesCall?.url.searchParams.get('dateInit')).toBe('2026-09-26T05:00:00.000Z');
    expect(expensesCall?.url.searchParams.get('dateEnd')).toBe('2026-10-03T04:59:59.999Z');
    // El proveedor llegó poblado: no hace falta pedir el catálogo de proveedores.
    expect(calls.some((c) => c.url.pathname === '/providers')).toBe(false);
  });

  it('restobar_list_expenses: con redacción no expone el beneficiario', async () => {
    const { call } = await connect(
      byPath({ '/expenses': { body: [{ _id: 'e1', paidTo: 'Persona Demo', subTotal: 1 }] } }),
      true,
    );
    const r = await call('restobar_list_expenses', PERIOD);
    expect(pick(r, 'expenses.0.paidTo')).toBeNull();
  });

  it('restobar_expenses_summary: totales por tipo con nombre resuelto', async () => {
    const { call, calls } = await connect(
      byPath({
        '/reports/reportUtilityGroupTypes': {
          body: [
            { _id: { typeExpense: 't1' }, totalSubTotal: 100, totalTaxes: 19 },
            {
              _id: { typeExpense: 't2' },
              totalSubTotal: 300,
              totalTaxes: 0,
              typeExpenseName: 'Arriendo',
            },
          ],
        },
        '/typeExpenses': { body: [{ _id: 't1', name: 'Insumos' }] },
      }),
    );
    const r = await call('restobar_expenses_summary', PERIOD);
    expect(pick(r, 'byExpenseType')).toEqual([
      { expenseType: 'Arriendo', subTotal: 300, taxes: 0, total: 300 },
      { expenseType: 'Insumos', subTotal: 100, taxes: 19, total: 119 },
    ]);
    expect(pick(r, 'grandTotal')).toBe(419);
    const report = calls.find((c) => c.url.pathname === '/reports/reportUtilityGroupTypes');
    expect(report?.url.searchParams.get('dateInitISO')).toBe('2026-09-26T05:00:00.000Z');
  });

  it('restobar_list_providers: filtra por nombre y respeta la redacción', async () => {
    const providers = [
      { _id: 'p1', name: 'Lácteos Demo', document: '900', email: 'a@b.co', phone: '300' },
      { _id: 'p2', name: 'Carnes Demo', tradename: 'La Res' },
      { _id: 'p3', name: 'Borrado', deleted: true },
    ];
    const { call } = await connect(byPath({ '/providers': { body: providers } }), true);
    const r = await call('restobar_list_providers', { search: 'res' });
    expect(pick(r, 'total')).toBe(1);
    expect(pick(r, 'providers.0')).toMatchObject({ id: 'p2', tradeName: 'La Res' });
    const all = await call('restobar_list_providers');
    expect(pick(all, 'total')).toBe(2);
    expect(pick(all, 'providers.0')).toMatchObject({
      document: null,
      email: null,
      phone: null,
    });
  });

  it('restobar_purchases_report: una factura con varias líneas cuenta una vez', async () => {
    const line = (item: string, quantity: number, price: number) => ({
      date: '2026-09-28T12:00:00.000Z',
      provider: { name: 'Proveedor Demo' },
      invoice: { invoiceNumber: 'C-1', total: 50000 },
      ingredient: { name: item, quantity, price },
    });
    const { call } = await connect(
      byPath({
        '/reports/reportPurchase': {
          body: { purchases: [line('Leche', 10, 3000), line('Queso', 2, 10000)], ivp: [] },
        },
      }),
    );
    const r = await call('restobar_purchases_report', PERIOD);
    expect(pick(r, 'totals')).toEqual({
      lines: 2,
      invoices: 1,
      invoicesTotal: 50000,
      linesTotal: 50000,
    });
    expect(pick(r, 'byProvider')).toEqual([
      { provider: 'Proveedor Demo', invoices: 1, total: 50000 },
    ]);
  });

  it('restobar_purchases_report: sin premium explica el motivo', async () => {
    const { call } = await connect(() => ({
      status: 402,
      body: { message: 'Requiere suscripción premium' },
    }));
    const r = await call('restobar_purchases_report', PERIOD);
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/premium/);
  });

  it('restobar_list_purchase_payments: filtra por fecha de registro', async () => {
    const { call } = await connect(
      byPath({
        '/inventoryInvoicePayments': {
          body: [
            { _id: 'x1', total: 100, inventory: 'm1', createdOn: '2026-09-27T12:00:00.000Z' },
            { _id: 'x2', total: 999, createdOn: '2026-08-01T12:00:00.000Z' },
          ],
        },
      }),
    );
    const r = await call('restobar_list_purchase_payments', PERIOD);
    expect(pick(r, 'payments')).toEqual([
      {
        id: 'x1',
        date: '2026-09-27T12:00:00.000Z',
        description: null,
        total: 100,
        subtractedFromCashRegister: null,
        inventoryMovementId: 'm1',
      },
    ]);
  });
});

describe('estadísticas y reportes de ventas', () => {
  it('restobar_sales_by_product: etiqueta plana o dentro de _id, orden y top', async () => {
    const { call, calls } = await connect(
      byPath({
        '/stats/totalInvoicesByProducts': {
          body: [
            { product: 'Café', quantity: 10, total: 30000 },
            { _id: { product: 'Pan' }, count: 5, total: 50000 },
            { _id: 'Jugo', total: 10000 },
          ],
        },
      }),
    );
    const r = await call('restobar_sales_by_product', { ...PERIOD, top: 2 });
    expect(pick(r, 'products')).toEqual([
      { product: 'Pan', total: 50000, count: 5 },
      { product: 'Café', total: 30000, count: 10 },
    ]);
    expect(pick(r, 'groups')).toBe(3);
    expect(pick(r, 'grandTotal')).toBe(90000);
    expect(calls[0]?.url.searchParams.get('dateEndISO')).toBe('2026-10-03T04:59:59.999Z');
  });

  it('restobar_orders_by_hour: lee la respuesta envuelta y ordena por hora', async () => {
    const { call } = await connect(
      byPath({
        '/stats/totalOrdersGroupByHours': {
          body: {
            totalOrdersTodayByHours: [
              { _id: { hour: 13 }, count: 8, total: 80 },
              { _id: 9, count: 2, total: 20 },
            ],
          },
        },
      }),
    );
    const r = await call('restobar_orders_by_hour', PERIOD);
    expect(pick(r, 'hours')).toMatchObject([{ hour: '09:00' }, { hour: '13:00' }]);
  });

  it('restobar_orders_by_weekday: nombra el día (1 = domingo)', async () => {
    const { call } = await connect(
      byPath({
        '/stats/totalOrdersGroupByDays': {
          body: { totalOrdersTodayByDays: [{ _id: { dayOfWeek: 6 }, count: 3, total: 9 }] },
        },
      }),
    );
    const r = await call('restobar_orders_by_weekday', PERIOD);
    expect(pick(r, 'weekdays.0.weekday')).toBe('6-viernes');
  });

  it('restobar_sales_by_category: lee reportByCategory', async () => {
    const { call } = await connect(
      byPath({
        '/reports/reportSalesByCategory': {
          body: {
            reportByCategory: [
              {
                _id: { _id: 'c1', name: 'Bebidas' },
                totalBruto: 10,
                totalDiscount: 1,
                totalTaxes: 2,
                total: 11,
              },
            ],
          },
        },
      }),
    );
    const r = await call('restobar_sales_by_category', PERIOD);
    expect(pick(r, 'categories')).toEqual([
      { category: 'Bebidas', gross: 10, discounts: 1, taxes: 2, total: 11 },
    ]);
  });

  it('restobar_product_profitability: costo y utilidad estimados', async () => {
    const { call, calls } = await connect(
      byPath({
        '/reports/reportUtility': {
          body: {
            reportByProduct: [
              {
                _id: { name: 'Café', categoryName: 'Bebidas' },
                quantity: 10,
                totalBruto: 30000,
                totalDiscount: 0,
                totalTaxes: 0,
                total: 30000,
                avgCost: 1000,
              },
            ],
          },
        },
      }),
    );
    const r = await call('restobar_product_profitability', PERIOD);
    expect(pick(r, 'products.0')).toMatchObject({
      product: 'Café',
      category: 'Bebidas',
      estimatedCost: 10000,
      estimatedProfit: 20000,
    });
    expect(calls[0]?.url.searchParams.get('groupResult')).toBe('true');
    expect(calls[0]?.url.searchParams.get('status')).toBe('Pagada');
  });

  it('restobar_profitability_summary: sin premium, compras fuera con nota', async () => {
    const { call } = await connect(
      byPath({
        '/stats/totalInvoicesByDays': {
          body: [
            {
              _id: { dayOfMonth: '2026-09-29' },
              total: 1100,
              totalWithoutTip: 1000,
              tip: 100,
              count: 3,
            },
          ],
        },
        '/expenses': { body: [{ _id: 'e1', subTotal: 300, taxes: 0 }] },
        '/reports/reportPurchase': { status: 402, body: { message: 'Premium requerido' } },
      }),
    );
    const r = await call('restobar_profitability_summary', PERIOD);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({
      sales: { total: 1100, withoutTip: 1000, tips: 100, invoices: 3 },
      expenses: { total: 300, count: 1 },
      purchases: null,
      result: 700,
    });
    expect(pick(r, 'notes.0')).toMatch(/Compras no incluidas/);
  });

  it('rechaza períodos invertidos sin consultar Restobar', async () => {
    const { call, calls } = await connect(() => ({ body: [] }));
    const r = await call('restobar_sales_by_seller', {
      dateFrom: '2026-10-02',
      dateTo: '2026-10-01',
    });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('inventario y configuración', () => {
  it('restobar_list_ingredients: paginación, unidad por ID y stock bajo', async () => {
    const { call, calls } = await connect(
      byPath({
        '/ingredients': {
          body: {
            data: [
              { _id: 'i1', name: 'Leche', unit: 'u1', stock: 2, stockMinimum: 5, price: 3000 },
            ],
            count: 161,
          },
        },
        '/units': { body: [{ _id: 'u1', name: 'Litro' }] },
      }),
    );
    const r = await call('restobar_list_ingredients', { search: 'lec', pageSize: 10 });
    expect(pick(r, 'ingredients.0')).toMatchObject({
      name: 'Leche',
      unit: 'Litro',
      lowStock: true,
      cost: 3000,
    });
    expect(pick(r, 'pagination')).toMatchObject({ total: 161, hasMore: true });
    const q = calls[0]?.url.searchParams;
    expect([q?.get('pagination'), q?.get('limit'), q?.get('page'), q?.get('name')]).toEqual([
      'true',
      '10',
      '0',
      'lec',
    ]);
  });

  it('restobar_shrinkage_report: líneas desde _id y totales', async () => {
    const { call } = await connect(
      byPath({
        '/reports/reportShrinkage': {
          body: [
            {
              _id: {
                ingredient: { name: 'Leche' },
                price: 3000,
                note: 'Vencida',
                date: '2026-09-28T10:00:00.000Z',
              },
              quantity: 2,
              total: 6000,
            },
          ],
        },
      }),
    );
    const r = await call('restobar_shrinkage_report', PERIOD);
    expect(pick(r, 'lines.0')).toMatchObject({
      item: 'Leche',
      quantity: 2,
      unitPrice: 3000,
      total: 6000,
      note: 'Vencida',
    });
    expect(pick(r, 'totals')).toEqual({ lines: 1, quantity: 2, total: 6000 });
  });

  it('restobar_list_tables: nunca expone la clave de la mesa', async () => {
    const { call } = await connect(
      byPath({
        '/tables': { body: [{ _id: 'm1', name: 'Mesa 1', password: '1234', isActive: true }] },
      }),
    );
    const r = await call('restobar_list_tables');
    expect(pick(r, 'tables.0')).toEqual({
      id: 'm1',
      name: 'Mesa 1',
      description: null,
      isHomeDelivery: null,
      isActive: true,
    });
    expect(JSON.stringify(r.content)).not.toContain('1234');
  });

  it('restobar_get_product: consulta por ID', async () => {
    const { call, calls } = await connect(
      byPath({ '/products/abc': { body: { _id: 'abc', name: 'Café', price: 3000 } } }),
    );
    const r = await call('restobar_get_product', { id: 'abc' });
    expect(pick(r, 'product')).toMatchObject({ id: 'abc', name: 'Café', price: 3000 });
    expect(calls[0]?.method).toBe('GET');
  });
});
