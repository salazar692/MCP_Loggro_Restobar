import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, describe, expect, it } from 'vitest';

import { LoggroError } from '../../src/errors.ts';
import { HttpClient } from '../../src/http/client.ts';
import { StaticTokenProvider } from '../../src/loggro/restobar/auth.ts';
import { RestobarClient } from '../../src/loggro/restobar/client.ts';
import { RESTOBAR_ALLOWLIST } from '../../src/loggro/restobar/operations.ts';
import { silentLogger } from '../../src/logging.ts';
import { createServer } from '../../src/server.ts';
import { VERSION } from '../../src/version.ts';
import { fakeFetch, type FakeResponse, type RecordedRequest } from '../helpers/fake-fetch.ts';
import { unzip } from '../helpers/unzip.ts';

const EXPECTED_TOOLS = [
  'restobar_clients_summary',
  'restobar_expenses_summary',
  'restobar_export_clients',
  'restobar_get_invoice',
  'restobar_get_product',
  'restobar_list_categories',
  'restobar_list_clients',
  'restobar_list_expense_types',
  'restobar_list_expenses',
  'restobar_list_ingredients',
  'restobar_list_invoices',
  'restobar_list_orders',
  'restobar_list_payment_methods',
  'restobar_list_products',
  'restobar_list_promos',
  'restobar_list_providers',
  'restobar_list_purchase_payments',
  'restobar_list_tables',
  'restobar_list_taxes',
  'restobar_list_units',
  'restobar_orders_by_hour',
  'restobar_orders_by_weekday',
  'restobar_product_profitability',
  'restobar_production_report',
  'restobar_profitability_summary',
  'restobar_purchases_report',
  'restobar_sales_by_biller',
  'restobar_sales_by_category',
  'restobar_sales_by_day',
  'restobar_sales_by_delivery_provider',
  'restobar_sales_by_month',
  'restobar_sales_by_payment_method',
  'restobar_sales_by_product',
  'restobar_sales_by_seller',
  'restobar_sales_by_table',
  'restobar_shrinkage_report',
  'restobar_transfers_report',
];

const exportDir = mkdtempSync(path.join(tmpdir(), 'mcp-loggro-e2e-'));
afterAll(async () => {
  const { rm } = await import('node:fs/promises');
  await rm(exportDir, { recursive: true, force: true });
});

async function connect(
  handler: (req: RecordedRequest) => FakeResponse,
  redact = false,
  dir: string | null = exportDir,
) {
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
    exportDir: dir,
    logger: silentLogger,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, calls: fake.calls };
}

describe('servidor MCP', () => {
  it('expone las herramientas esperadas; solo la exportación escribe (un archivo local nuevo)', async () => {
    const { client } = await connect(() => ({ body: [] }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    for (const tool of tools) {
      const writesLocalFile = tool.name === 'restobar_export_clients';
      expect(tool.annotations).toMatchObject({
        readOnlyHint: !writesLocalFile,
        destructiveHint: false,
      });
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it('modo remoto (sin carpeta local): no ofrece exportar y todo es solo lectura', async () => {
    const { client } = await connect(() => ({ body: [] }), false, null);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      EXPECTED_TOOLS.filter((name) => name !== 'restobar_export_clients'),
    );
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(client.getInstructions()).toMatch(/servidor es remoto/);
  });

  it('un error de la fuente del token llega al modelo con su mensaje', async () => {
    const http = new HttpClient({
      baseUrl: 'https://api.pirpos.test',
      allowlist: RESTOBAR_ALLOWLIST,
      fetch: fakeFetch(() => ({ body: [] })).fetch,
    });
    const tokens = {
      getToken: () =>
        Promise.reject(new LoggroError('auth', 'La cuenta no tiene credenciales guardadas.')),
      invalidate: () => false,
    };
    const server = createServer({
      restobar: new RestobarClient(http, tokens),
      redactPersonalData: false,
      timeZone: 'America/Bogota',
      exportDir: null,
      logger: silentLogger,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
    const result = await client.callTool({ name: 'restobar_list_categories', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/no tiene credenciales guardadas/);
  });

  it('restobar_list_invoices: mapea fechas, paginación y salida', async () => {
    const { client, calls } = await connect(() => ({
      body: {
        data: [
          {
            _id: 'f1',
            invoicePrefix: 'FV',
            number: '120',
            total: 50000,
            totalPaid: 50000,
            subTotal: 48000,
            totalDiscount: 0,
            totalTaxes: 0,
            tip: 2000,
            paymentMethod: 'Efectivo',
            seller: { idInternal: 's1', name: 'Vendedor Demo' },
            status: 'Pagada',
            type: 'Factura',
            createdOn: '2026-09-28T18:00:00.000Z',
            // Forma real: el cliente embebido no trae ID.
            client: { name: 'Cliente Demo', phone: '3000000000' },
            business: { nit: '900000000', address: 'Calle 1' },
            eInvoice: { DIAN: { dianState: '00' } },
          },
        ],
        count: 41,
      },
    }));
    const result = await client.callTool({
      name: 'restobar_list_invoices',
      arguments: { dateFrom: '2026-09-28', dateTo: '2026-09-28', page: 2, pageSize: 20 },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      invoices: [
        {
          id: 'f1',
          prefix: 'FV',
          number: '120',
          status: 'Pagada',
          type: 'Factura',
          subTotal: 48000,
          totalDiscount: 0,
          totalTaxes: 0,
          tip: 2000,
          total: 50000,
          totalPaid: 50000,
          paymentMethod: 'Efectivo',
          seller: 'Vendedor Demo',
          createdOn: '2026-09-28T18:00:00.000Z',
          client: { id: null, name: 'Cliente Demo', phone: '3000000000' },
          table: null,
          dianState: '00',
        },
      ],
      pagination: { page: 2, pageSize: 20, total: 41, hasMore: true },
    });
    const query = Object.fromEntries(calls[0]?.url.searchParams ?? []);
    expect(query).toMatchObject({
      page: '1',
      limit: '20',
      pagination: 'true',
      dateInit: '2026-09-28T05:00:00.000Z',
      dateEnd: '2026-09-29T04:59:59.999Z',
    });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('oculta datos personales cuando la redacción está activa', async () => {
    const { client } = await connect(
      () => ({
        body: { data: [{ _id: 'c1', name: 'Ana', document: '123', phone: '300' }], count: 1 },
      }),
      true,
    );
    const result = await client.callTool({ name: 'restobar_list_clients', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      clients: [{ id: 'c1', name: 'Ana', document: null, phone: null }],
    });
  });

  it('devuelve errores accionables sin detalles internos', async () => {
    const { client } = await connect(() => ({
      status: 402,
      body: { message: 'Esta funcionalidad requiere una suscripción premium' },
    }));
    const result = await client.callTool({ name: 'restobar_list_categories', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/plan premium/);
    expect(JSON.stringify(result.content)).not.toContain('tok');
  });

  it('lee el día de ventas desde _id.dayOfMonth, como responde la API real', async () => {
    const { client } = await connect(() => ({
      body: [
        {
          _id: { businessId: 'b1', dayOfMonth: '2026-09-27' },
          total: 100,
          dateInit: '2026-09-27T05:00:00.000Z',
          dateEnd: '2026-09-28T04:59:59.999Z',
          totalWithoutTip: 90,
          tip: 10,
          count: 4,
        },
      ],
    }));
    const result = await client.callTool({
      name: 'restobar_sales_by_day',
      arguments: { dateFrom: '2026-09-27', dateTo: '2026-09-27' },
    });
    expect(result.structuredContent).toEqual({
      days: [{ date: '2026-09-27', total: 100, invoices: 4 }],
      grandTotal: 100,
    });
  });

  it('pedidos y productos: lee los campos con la forma real de la API', async () => {
    const { client } = await connect((req) =>
      req.url.pathname === '/orders'
        ? {
            body: {
              data: [{ _id: 'o1', complementary: { isComplementary: true }, quantity: 1 }],
              count: 1,
            },
          }
        : {
            body: {
              data: [
                {
                  _id: 'p1',
                  name: 'Producto',
                  price: 12000,
                  inventoryType: 'PerUnit',
                  category: { _id: 'cat1', name: 'Categoría' },
                  locationsStock: [
                    {
                      locationStock: { _id: 'loc1', name: 'Bodega' },
                      isMain: true,
                      tax: { name: 'Impoconsumo', percentage: 8 },
                    },
                  ],
                },
              ],
              count: 1,
            },
          },
    );
    const orders = await client.callTool({ name: 'restobar_list_orders', arguments: {} });
    expect(orders.structuredContent).toMatchObject({ orders: [{ complementary: true }] });
    const products = await client.callTool({ name: 'restobar_list_products', arguments: {} });
    expect(products.structuredContent).toMatchObject({
      products: [
        {
          categoryId: 'cat1',
          categoryName: 'Categoría',
          price: 12000,
          inventoryType: 'PerUnit',
          locations: [
            {
              locationId: 'loc1',
              locationName: 'Bodega',
              taxName: 'Impoconsumo',
              taxPercentage: 8,
            },
          ],
        },
      ],
    });
  });

  it('restobar_get_invoice: productos, desglose de pagos y vendedor con la forma real', async () => {
    const { client, calls } = await connect(() => ({
      body: {
        _id: 'f1',
        seller: { idInternal: 's1', name: 'Vendedor Demo' },
        paymentMethod: 'Efectivo',
        paid: {
          createdOn: '2026-09-28T18:00:00.000Z',
          paymentMethodValue: [{ paymentMethod: 'Efectivo', value: 50000, tip: 2000 }],
        },
        products: [
          {
            idInternal: 'p1',
            name: 'Producto',
            categoryName: 'Categoría',
            quantity: 2,
            price: 24000,
            discount: 0,
            total: 48000,
          },
        ],
      },
    }));
    const result = await client.callTool({ name: 'restobar_get_invoice', arguments: { id: 'f1' } });
    expect(calls[0]?.url.pathname).toBe('/invoices/f1');
    expect(result.structuredContent).toMatchObject({
      invoice: {
        seller: 'Vendedor Demo',
        paymentMethod: 'Efectivo',
        payments: [{ method: 'Efectivo', value: 50000, tip: 2000 }],
        products: [
          {
            id: 'p1',
            category: 'Categoría',
            quantity: 2,
            unitPrice: 24000,
            discount: 0,
            total: 48000,
          },
        ],
      },
    });
  });

  it('valida argumentos antes de llamar a Restobar', async () => {
    const { client, calls } = await connect(() => ({ body: [] }));
    const result = await client.callTool({
      name: 'restobar_sales_by_day',
      arguments: { dateFrom: '28/09/2026', dateTo: '2026-09-28' },
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

/** /clients paginado: `total` clientes de prueba, página y límite según la consulta. */
function clientsApi(total: number, served = total) {
  return (req: RecordedRequest): FakeResponse => {
    const page = Number(req.url.searchParams.get('page'));
    const limit = Number(req.url.searchParams.get('limit'));
    const data = Array.from(
      { length: Math.max(0, Math.min(limit, served - page * limit)) },
      (_, k) => {
        const i = page * limit + k;
        return {
          _id: `c${i}`,
          name: `Cliente ${i}`,
          isSocialReason: i % 10 === 0,
          document: `00${i}`,
          email: i % 2 === 0 ? `cliente${i}@ejemplo.test` : null,
          phone: '3000000000',
          // Forma real de la API: la ciudad viene en cityDetail (no hay `city`).
          cityDetail: {
            countryCode: 'CO',
            stateName: 'Bogotá D.C.',
            cityName: i % 3 === 0 ? 'Bogotá' : 'BOGOTA',
          },
          ...(i % 10 === 0 && {
            contact: { firstName: 'Ana', lastName: 'Contacto', email: `contacto${i}@ejemplo.test` },
          }),
          points: i % 4 === 0 ? 10 : 0,
          createdOn: '2026-09-01T03:00:00.000Z', // 31 de agosto en Bogotá
        };
      },
    );
    return { body: { data, count: total } };
  };
}

describe('listados grandes', () => {
  it('avisa que no se recorran todas las páginas y sugiere exportar o resumir', async () => {
    const { client } = await connect(() => ({ body: { data: [], count: 3482 } }));
    const result = await client.callTool({ name: 'restobar_list_clients', arguments: {} });
    const { pagination } = result.structuredContent as { pagination: { notice?: string } };
    expect(pagination.notice).toMatch(/^Hay 3482 resultados \(175 páginas de 20\)/);
    expect(pagination.notice).toContain('restobar_export_clients');
  });

  it('no avisa con pocos resultados', async () => {
    const { client } = await connect(() => ({ body: { data: [], count: 150 } }));
    const result = await client.callTool({ name: 'restobar_list_clients', arguments: {} });
    expect(result.structuredContent).toMatchObject({ pagination: { total: 150 } });
    expect(JSON.stringify(result.structuredContent)).not.toContain('notice');
  });

  it('restobar_clients_summary: descarga por lotes y devuelve solo cifras', async () => {
    const { client, calls } = await connect(clientsApi(1100));
    const result = await client.callTool({ name: 'restobar_clients_summary', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(calls.map((c) => c.url.searchParams.get('page'))).toEqual(['0', '1', '2']);
    expect(
      calls.every((c) => c.method === 'GET' && c.url.searchParams.get('limit') === '500'),
    ).toBe(true);
    expect(result.structuredContent).toMatchObject({
      clients: 1100,
      reportedTotal: 1100,
      complete: true,
      companies: 110,
      individuals: 990,
      withEmail: 550,
      withLoyaltyPoints: 275,
      totalLoyaltyPoints: 2750,
      newClientsByYear: [{ year: '2026', count: 1100 }],
      topCities: [{ city: 'Bogotá', count: 1100 }],
      restobarRequests: 3,
    });
    const text = JSON.stringify(result.structuredContent);
    expect(text).not.toContain('@ejemplo.test');
    expect(text).toContain('{"month":"2026-08","count":1100}');
  });

  it('restobar_clients_summary: marca como incompleto si Restobar entrega menos', async () => {
    const { client } = await connect(clientsApi(1100, 700));
    const result = await client.callTool({ name: 'restobar_clients_summary', arguments: {} });
    expect(result.structuredContent).toMatchObject({ clients: 700, complete: false });
  });

  it('rechaza descargas demasiado grandes tras una sola solicitud', async () => {
    const { client, calls } = await connect(clientsApi(80_000));
    const result = await client.callTool({ name: 'restobar_export_clients', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/máximo por descarga es 50000/);
    expect(calls).toHaveLength(1);
  });

  it('restobar_export_clients: crea un Excel local y al modelo solo le da ruta y conteo', async () => {
    const { client } = await connect(clientsApi(3));
    const result = await client.callTool({
      name: 'restobar_export_clients',
      arguments: { search: 'Cliente' },
    });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { file: string; rows: number; columns: string[] };
    expect(out).toMatchObject({ rows: 3, complete: true, personalDataIncluded: true });
    expect(path.dirname(out.file)).toBe(exportDir);
    expect(path.basename(out.file)).toMatch(
      /^restobar-clientes-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?\.xlsx$/,
    );
    expect(JSON.stringify(result)).not.toContain('@ejemplo.test');
    const sheet = unzip(readFileSync(out.file)).get('xl/worksheets/sheet1.xml') ?? '';
    expect(sheet).toContain('cliente0@ejemplo.test');
    expect(sheet).toContain('>000</t>'); // documento con ceros a la izquierda
    expect(sheet).toContain('>2026-08-31 22:00</t>'); // fecha de creación en hora de Bogotá
    expect(sheet).toContain('>Bogotá D.C.</t>'); // departamento desde cityDetail
    expect(sheet).toContain('>Ana Contacto</t>');
    expect(sheet).toContain('contacto0@ejemplo.test');
    expect(out.columns).toEqual(expect.arrayContaining(['Ciudad', 'Departamento', 'Contacto']));
  });

  it('restobar_export_clients: con redacción activa omite las columnas personales', async () => {
    const { client } = await connect(clientsApi(2), true);
    const result = await client.callTool({ name: 'restobar_export_clients', arguments: {} });
    const out = result.structuredContent as { file: string; columns: string[] };
    expect(out.columns).not.toContain('Correo');
    expect(out.columns).toContain('Nombre');
    const sheet = unzip(readFileSync(out.file)).get('xl/worksheets/sheet1.xml') ?? '';
    expect(sheet).not.toContain('@ejemplo.test');
    expect(readdirSync(exportDir).length).toBeGreaterThan(0);
  });
});

describe('versión', () => {
  it('coincide con package.json', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8'),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
