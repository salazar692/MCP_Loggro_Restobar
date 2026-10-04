import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { LoggroError } from '../../errors.ts';
import type { AllowedOperation } from '../../http/client.ts';
import { RESTOBAR_OPERATIONS as OPS } from '../../loggro/restobar/operations.ts';
import { READ_ONLY_ANNOTATIONS, UNTRUSTED_NOTE, runTool } from '../shared.ts';
import type { RestobarToolContext } from './context.ts';
import {
  at,
  groupLabel,
  groupNumber,
  isoPeriod,
  num,
  periodInput,
  periodOutput,
  rows,
  sum,
  text,
  type Raw,
} from './extract.ts';

const nullableText = z.string().nullable();
const nullableNumber = z.number().nullable();

const topInput = z
  .number()
  .int()
  .min(1)
  .max(200)
  .default(30)
  .describe('Cuántos grupos devolver, de mayor a menor total (1 a 200).');

interface GroupedStat {
  name: string;
  title: string;
  description: string;
  op: AllowedOperation;
  /** Clave del arreglo de salida, p. ej. `products`. */
  listKey: string;
  /** Nombre del campo con la etiqueta del grupo, p. ej. `product`. */
  labelKey: string;
  /** Dónde buscar la etiqueta en cada fila de Restobar. */
  labelSources: string[];
  /** Arreglo envolvente en la respuesta, si lo hay. */
  wrapper?: string;
  countLabel: string;
  /** Las listas largas (productos) aceptan `top`. */
  withTop?: boolean;
  /** Etiqueta calculada (horas, días de la semana, meses). */
  label?: (row: Raw) => string | null;
  /** Orden natural (horas, días) en lugar de mayor a menor total. */
  sortByLabel?: boolean;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const STATS: GroupedStat[] = [
  {
    name: 'restobar_sales_by_product',
    title: 'Ventas por producto (Restobar)',
    description:
      'Total facturado y unidades vendidas por producto en un período, de mayor a menor. Útil para «¿qué se vendió más?». Requiere plan premium y el permiso ST_GET_PRODUCTS.',
    op: OPS.salesByProduct,
    listKey: 'products',
    labelKey: 'product',
    labelSources: ['product', 'productName', 'name'],
    countLabel: 'Unidades vendidas.',
    withTop: true,
  },
  {
    name: 'restobar_sales_by_payment_method',
    title: 'Ventas por método de pago (Restobar)',
    description:
      'Total facturado por método de pago (efectivo, tarjeta, transferencia…) en un período. Requiere plan premium y el permiso ST_GET_PAYMENT_METHOD.',
    op: OPS.salesByPaymentMethod,
    listKey: 'paymentMethods',
    labelKey: 'paymentMethod',
    labelSources: ['paymentMethod', 'paymentMethodName', 'name'],
    countLabel: 'Número de pagos o facturas.',
  },
  {
    name: 'restobar_sales_by_seller',
    title: 'Ventas por vendedor (Restobar)',
    description:
      'Total facturado por vendedor o mesero en un período. Requiere plan premium y el permiso ST_GET_SELLERS.',
    op: OPS.salesBySeller,
    listKey: 'sellers',
    labelKey: 'seller',
    labelSources: ['seller', 'sellerName', 'name'],
    countLabel: 'Número de facturas.',
  },
  {
    name: 'restobar_sales_by_table',
    title: 'Ventas por mesa (Restobar)',
    description:
      'Total facturado por mesa (incluye domicilio o mostrador si se registran como mesa) en un período. Requiere plan premium y el permiso ST_GET_TABLES.',
    op: OPS.salesByTable,
    listKey: 'tables',
    labelKey: 'table',
    labelSources: ['table', 'tableName', 'name'],
    countLabel: 'Número de facturas.',
  },
  {
    name: 'restobar_sales_by_month',
    title: 'Ventas por mes (Restobar)',
    description:
      'Total facturado por mes en un período (puede abarcar varios meses). Requiere plan premium y el permiso ST_GET_SALES.',
    op: OPS.salesByMonth,
    listKey: 'months',
    labelKey: 'month',
    labelSources: ['month', 'monthOfYear', 'date'],
    countLabel: 'Número de facturas.',
    sortByLabel: true,
    label: (row) => {
      const year = groupNumber(row, 'year');
      const month = groupNumber(row, 'month', 'monthOfYear');
      if (year !== null && month !== null) return `${year}-${String(month).padStart(2, '0')}`;
      const start = text(row.dateInit);
      return start ? start.slice(0, 7) : null;
    },
  },
  {
    name: 'restobar_sales_by_delivery_provider',
    title: 'Ventas por canal de domicilio (Restobar)',
    description:
      'Total facturado por proveedor de domicilio (RAPPI, UBER_EATS, DIDI_FOOD, INTERNAL) en un período. Requiere plan premium.',
    op: OPS.salesByDeliveryProvider,
    listKey: 'deliveryProviders',
    labelKey: 'deliveryProvider',
    labelSources: ['deliveryProvider', 'name'],
    countLabel: 'Número de facturas.',
  },
  {
    name: 'restobar_sales_by_biller',
    title: 'Ventas por cajero o facturador (Restobar)',
    description:
      'Total facturado por la persona que emitió las facturas (cajero) en un período. Requiere el permiso ST_GET_SALES.',
    op: OPS.salesByBiller,
    listKey: 'billers',
    labelKey: 'biller',
    labelSources: ['biller', 'cashier', 'user', 'name'],
    countLabel: 'Número de facturas.',
  },
  {
    name: 'restobar_orders_by_hour',
    title: 'Pedidos por hora del día (Restobar)',
    description:
      'Pedidos y total por hora del día (0 a 23, hora del negocio) en un período: muestra las horas pico. Requiere plan premium.',
    op: OPS.ordersByHour,
    wrapper: 'totalOrdersTodayByHours',
    listKey: 'hours',
    labelKey: 'hour',
    labelSources: ['hour'],
    countLabel: 'Número de pedidos.',
    sortByLabel: true,
    label: (row) => {
      // El grupo puede venir como `_id` numérico (MongoDB $hour).
      const hour = groupNumber(row, 'hour') ?? num(row._id);
      return hour === null ? null : `${String(hour).padStart(2, '0')}:00`;
    },
  },
  {
    name: 'restobar_orders_by_weekday',
    title: 'Pedidos por día de la semana (Restobar)',
    description:
      'Pedidos y total por día de la semana en un período: muestra los días de más movimiento. Requiere plan premium.',
    op: OPS.ordersByWeekday,
    wrapper: 'totalOrdersTodayByDays',
    listKey: 'weekdays',
    labelKey: 'weekday',
    labelSources: ['dayOfWeek', 'day'],
    countLabel: 'Número de pedidos.',
    sortByLabel: true,
    label: (row) => {
      // MongoDB $dayOfWeek: 1 = domingo … 7 = sábado.
      const day = groupNumber(row, 'dayOfWeek', 'day') ?? num(row._id);
      return day !== null && day >= 1 && day <= 7 ? `${day}-${WEEKDAYS[day - 1]}` : null;
    },
  },
];

function registerGroupedStat(server: McpServer, ctx: RestobarToolContext, s: GroupedStat): void {
  const rowOut = z.object({
    [s.labelKey]: nullableText,
    total: nullableNumber,
    count: nullableNumber.describe(s.countLabel),
  });
  server.registerTool(
    s.name,
    {
      title: s.title,
      description: `${s.description} Período YYYY-MM-DD, ambos inclusive. Solo lectura. ${UNTRUSTED_NOTE}`,
      inputSchema: s.withTop ? { ...periodInput, top: topInput } : periodInput,
      outputSchema: {
        period: periodOutput,
        [s.listKey]: z.array(rowOut),
        groups: z.number().describe('Grupos que devolvió Restobar.'),
        grandTotal: z.number().describe('Suma del total de todos los grupos.'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args: { dateFrom: string; dateTo: string; top?: number }) =>
      runTool(ctx.logger, s.name, async () => {
        const period = isoPeriod(args, ctx.timeZone);
        const body = await ctx.restobar.read(s.op, {
          query: { dateInitISO: period.start, dateEndISO: period.end },
        });
        const list = (s.wrapper ? rows(body, s.wrapper) : rows(body)).map((r) => ({
          [s.labelKey]: s.label?.(r) ?? groupLabel(r, ...s.labelSources),
          total: groupNumber(r, 'total', 'totalSales', 'value'),
          count: groupNumber(r, 'count', 'quantity', 'totalOrders', 'invoices'),
        }));
        const sorted = s.sortByLabel
          ? list.sort((a, b) =>
              String(a[s.labelKey] ?? '').localeCompare(String(b[s.labelKey] ?? '')),
            )
          : list.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
        return {
          period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
          [s.listKey]: args.top ? sorted.slice(0, args.top) : sorted,
          groups: list.length,
          grandTotal: sum(list.map((r) => r.total)),
        };
      }),
  );
}

export function registerReportTools(server: McpServer, ctx: RestobarToolContext): void {
  for (const stat of STATS) registerGroupedStat(server, ctx, stat);

  server.registerTool(
    'restobar_sales_by_category',
    {
      title: 'Ventas por categoría (Restobar)',
      description: [
        'Ventas de un período agrupadas por categoría de producto: valor bruto, descuentos, impuestos y',
        'total. Período YYYY-MM-DD, ambos inclusive. Requiere plan premium. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: periodInput,
      outputSchema: {
        period: periodOutput,
        categories: z.array(
          z.object({
            category: nullableText,
            gross: nullableNumber.describe('Valor bruto antes de descuentos.'),
            discounts: nullableNumber,
            taxes: nullableNumber,
            total: nullableNumber,
          }),
        ),
        grandTotal: z.number(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_sales_by_category', async () => {
        const period = isoPeriod(args, ctx.timeZone);
        const body = await ctx.restobar.read(OPS.reportSalesByCategory, {
          query: { dateInitISO: period.start, dateEndISO: period.end },
        });
        const categories = rows(body, 'reportByCategory')
          .map((r) => ({
            category: groupLabel(r, 'categoryName', 'category'),
            gross: num(r.totalBruto),
            discounts: num(r.totalDiscount),
            taxes: num(r.totalTaxes),
            total: num(r.total),
          }))
          .sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
        return {
          period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
          categories,
          grandTotal: sum(categories.map((c) => c.total)),
        };
      }),
  );

  server.registerTool(
    'restobar_product_profitability',
    {
      title: 'Rentabilidad por producto (Restobar)',
      description: [
        'Reporte de utilidad de Restobar por producto en un período (facturas pagadas): unidades, ventas',
        'brutas, descuentos, impuestos, total, costo promedio unitario y una utilidad ESTIMADA',
        '(total − impuestos − costo promedio × unidades). La utilidad depende de que los costos estén',
        'bien cargados en Restobar. Período YYYY-MM-DD, ambos inclusive. Requiere plan premium. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: { ...periodInput, top: topInput },
      outputSchema: {
        period: periodOutput,
        products: z.array(
          z.object({
            product: nullableText,
            category: nullableText,
            quantity: nullableNumber,
            gross: nullableNumber,
            discounts: nullableNumber,
            taxes: nullableNumber,
            total: nullableNumber,
            unitAvgCost: nullableNumber.describe('Costo promedio por unidad según Restobar.'),
            estimatedCost: nullableNumber.describe('unitAvgCost × quantity.'),
            estimatedProfit: nullableNumber.describe('total − taxes − estimatedCost.'),
          }),
        ),
        totals: z.object({
          products: z.number(),
          total: z.number(),
          taxes: z.number(),
          estimatedCost: z.number(),
          estimatedProfit: z.number(),
        }),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_product_profitability', async () => {
        const period = isoPeriod(args, ctx.timeZone);
        const body = await ctx.restobar.read(OPS.reportUtility, {
          query: {
            dateInitISO: period.start,
            dateEndISO: period.end,
            groupResult: true,
            status: 'Pagada',
          },
        });
        const products = rows(body, 'reportByProduct')
          .map((r) => {
            const quantity = num(r.quantity);
            const total = num(r.total);
            const taxes = num(r.totalTaxes);
            const unitAvgCost = num(r.avgCost) ?? num(at(r, '_id.avgCost'));
            const estimatedCost =
              unitAvgCost !== null && quantity !== null ? unitAvgCost * quantity : null;
            return {
              product: groupLabel(r, 'name', 'productName'),
              category: text(at(r, '_id.categoryName', 'categoryName')),
              quantity,
              gross: num(r.totalBruto),
              discounts: num(r.totalDiscount),
              taxes,
              total,
              unitAvgCost,
              estimatedCost,
              estimatedProfit:
                total !== null && estimatedCost !== null
                  ? total - (taxes ?? 0) - estimatedCost
                  : null,
            };
          })
          .sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
        return {
          period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
          products: products.slice(0, args.top),
          totals: {
            products: products.length,
            total: sum(products.map((p) => p.total)),
            taxes: sum(products.map((p) => p.taxes)),
            estimatedCost: sum(products.map((p) => p.estimatedCost)),
            estimatedProfit: sum(products.map((p) => p.estimatedProfit)),
          },
        };
      }),
  );

  server.registerTool(
    'restobar_profitability_summary',
    {
      title: 'Ventas frente a gastos y compras (Restobar)',
      description: [
        'Resumen de un período: ventas (total y sin propinas), gastos registrados, compras de inventario',
        'a proveedores y el resultado aproximado (ventas sin propinas − gastos − compras). Es flujo de',
        'caja aproximado, no un estado de resultados contable. Si las compras no están disponibles (plan',
        'sin premium), se indica y el resultado las omite. Período YYYY-MM-DD, ambos inclusive. Solo lectura.',
      ].join(' '),
      inputSchema: periodInput,
      outputSchema: {
        period: periodOutput,
        sales: z.object({
          total: z.number(),
          withoutTip: z.number(),
          tips: z.number(),
          invoices: z.number(),
        }),
        expenses: z.object({ total: z.number(), count: z.number() }),
        purchases: z
          .object({ total: z.number(), invoices: z.number() })
          .nullable()
          .describe('null si Restobar no permitió consultar las compras.'),
        result: z.number().describe('sales.withoutTip − expenses.total − purchases.total.'),
        notes: z.array(z.string()),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_profitability_summary', async () => {
        const period = isoPeriod(args, ctx.timeZone);
        const [days, expensesBody, purchasesBody] = await Promise.all([
          ctx.restobar.salesByDay({ dateInitISO: period.start, dateEndISO: period.end }),
          ctx.restobar.read(OPS.listExpenses, {
            query: { dateInit: period.start, dateEnd: period.end },
          }),
          ctx.restobar
            .read(OPS.reportPurchases, {
              query: { dateInitISO: period.start, dateEndISO: period.end },
            })
            .catch((err: unknown) => err),
        ]);
        const notes: string[] = [];
        const salesTotal = sum(days.map((d) => d.total ?? null));
        const tips = sum(days.map((d) => d.tip ?? null));
        const withoutTip = days.some((d) => typeof d.totalWithoutTip === 'number')
          ? sum(days.map((d) => d.totalWithoutTip ?? null))
          : salesTotal - tips;
        const expenseRows = rows(expensesBody).filter(
          (r) => r.deleted !== true && at(r, 'deletedInfo.isDeleted') !== true,
        );
        const expensesTotal = sum(
          expenseRows.map((r) => (num(r.subTotal) ?? 0) + (num(r.taxes) ?? 0)),
        );
        let purchases: { total: number; invoices: number } | null = null;
        if (purchasesBody instanceof LoggroError) {
          notes.push(`Compras no incluidas: ${purchasesBody.message}`);
        } else if (purchasesBody instanceof Error) {
          throw purchasesBody;
        } else {
          const invoices = new Map<string, number>();
          for (const r of rows(purchasesBody, 'purchases')) {
            const key = `${text(at(r, 'provider.name')) ?? ''}|${text(at(r, 'invoice.invoiceNumber')) ?? text(r.date) ?? ''}`;
            if (!invoices.has(key)) invoices.set(key, num(at(r, 'invoice.total')) ?? 0);
          }
          purchases = { total: sum([...invoices.values()]), invoices: invoices.size };
        }
        notes.push(
          'Las ventas son el total facturado; los gastos y las compras son los registrados en Restobar. No incluye nómina ni otros costos que no se registren allí.',
        );
        return {
          period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
          sales: {
            total: salesTotal,
            withoutTip,
            tips,
            invoices: sum(days.map((d) => d.count ?? null)),
          },
          expenses: { total: expensesTotal, count: expenseRows.length },
          purchases,
          result: withoutTip - expensesTotal - (purchases?.total ?? 0),
          notes,
        };
      }),
  );
}
