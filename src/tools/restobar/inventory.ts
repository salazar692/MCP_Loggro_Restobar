import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AllowedOperation } from '../../http/client.ts';
import { RESTOBAR_OPERATIONS as OPS } from '../../loggro/restobar/operations.ts';
import {
  READ_ONLY_ANNOTATIONS,
  UNTRUSTED_NOTE,
  pageInfo,
  paginationInput,
  paginationOutput,
  runTool,
  toRestobarPage,
} from '../shared.ts';
import { ProductOut, toProductOut } from './catalog.ts';
import type { RestobarToolContext } from './context.ts';
import {
  at,
  bool,
  isObject,
  isoPeriod,
  nameMap,
  num,
  periodInput,
  periodOutput,
  refId,
  refName,
  rows,
  sum,
  text,
  type Raw,
} from './extract.ts';

const nullableText = z.string().nullable();
const nullableNumber = z.number().nullable();
const MAX_LINES = 200;

interface MovementReport {
  name: string;
  title: string;
  description: string;
  op: AllowedOperation;
}

const MOVEMENT_REPORTS: MovementReport[] = [
  {
    name: 'restobar_production_report',
    title: 'Producción de inventario (Restobar)',
    description:
      'Reporte de producciones de inventario (preparaciones que transforman ingredientes) en un período.',
    op: OPS.reportProduction,
  },
  {
    name: 'restobar_transfers_report',
    title: 'Traslados de inventario (Restobar)',
    description:
      'Reporte de traslados de ingredientes y productos entre ubicaciones o bodegas en un período: origen, destino y cantidad.',
    op: OPS.reportTransfers,
  },
  {
    name: 'restobar_shrinkage_report',
    title: 'Mermas de inventario (Restobar)',
    description:
      'Reporte de mermas (pérdidas, daños, vencimientos) de inventario en un período: ingrediente, cantidad, costo y nota.',
    op: OPS.reportShrinkage,
  },
];

/** Línea de un reporte de inventario: los datos vienen en `_id` (agrupación) o en la fila. */
function movementLine(r: Raw) {
  const field = (key: string): unknown => at(r, `_id.${key}`, key);
  const location = (v: unknown): string | null => (isObject(v) ? text(v.name) : null);
  return {
    date: text(field('date')),
    item: text(at(r, '_id.ingredient.name', 'ingredient.name', '_id.product.name', 'product.name')),
    quantity: num(r.quantity) ?? num(field('quantity')),
    unitPrice: num(field('price')),
    total: num(r.total),
    from: location(field('locationStock')),
    to: location(field('locationStockTo')),
    note: text(field('note')),
  };
}

export function registerInventoryTools(server: McpServer, ctx: RestobarToolContext): void {
  server.registerTool(
    'restobar_list_ingredients',
    {
      title: 'Ingredientes e insumos (Restobar)',
      description: [
        'Busca ingredientes e insumos de inventario en Restobar por nombre o categoría: unidad, stock,',
        'stock mínimo, costo y stock por ubicación. lowStock indica si el stock está por debajo del mínimo.',
        'Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: {
        search: z.string().min(1).optional().describe('Parte del nombre.'),
        categoryId: z.string().min(1).optional().describe('ID de la categoría.'),
        ...paginationInput,
      },
      outputSchema: {
        ingredients: z.array(
          z.object({
            id: z.string(),
            name: nullableText,
            category: nullableText,
            unit: nullableText,
            stock: nullableNumber,
            stockMinimum: nullableNumber,
            lowStock: z.boolean().nullable(),
            cost: nullableNumber.describe('Costo o precio registrado del insumo.'),
            isActive: z.boolean().nullable(),
            locations: z.array(
              z.object({
                location: nullableText,
                stock: nullableNumber,
                stockMinimum: nullableNumber,
              }),
            ),
          }),
        ),
        pagination: paginationOutput,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_list_ingredients', async () => {
        const body = await ctx.restobar.read(OPS.listIngredients, {
          query: {
            pagination: true,
            ...toRestobarPage(args.page, args.pageSize),
            name: args.search,
            categoryId: args.categoryId,
          },
        });
        const list = rows(body);
        // La unidad puede llegar como ID: se resuelve con el catálogo solo si hace falta.
        const units = list.some((r) => typeof r.unit === 'string')
          ? nameMap(await ctx.restobar.read(OPS.listUnits))
          : undefined;
        const count = isObject(body) ? num(body.count) : null;
        return {
          ingredients: list.map((r) => {
            const stock = num(r.stock);
            const stockMinimum = num(r.stockMinimum);
            return {
              id: refId(r) ?? '',
              name: text(r.name),
              category: refName(r.category),
              unit: refName(r.unit, units),
              stock,
              stockMinimum,
              lowStock: stock !== null && stockMinimum !== null ? stock < stockMinimum : null,
              cost: num(r.pricePurchase) ?? num(r.avgCost) ?? num(r.price),
              isActive: bool(r.isActive),
              locations: (Array.isArray(r.locationsStock) ? r.locationsStock : [])
                .filter(isObject)
                .map((l) => ({
                  location: refName(l.locationStock),
                  stock: num(l.stock),
                  stockMinimum: num(l.stockMinimum),
                })),
            };
          }),
          pagination: pageInfo(
            args.page,
            args.pageSize,
            count,
            list.length,
            'No recorras todas las páginas: afina con search o categoryId.',
          ),
        };
      }),
  );

  server.registerTool(
    'restobar_get_product',
    {
      title: 'Ver un producto (Restobar)',
      description: [
        'Detalle de un producto por su ID (de restobar_list_products o restobar_list_orders): categoría,',
        'precio, costo, stock y stock y precio por ubicación. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: { id: z.string().min(1).describe('ID del producto.') },
      outputSchema: { product: ProductOut },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_get_product', async () => ({
        product: toProductOut(await ctx.restobar.getProduct(args.id)),
      })),
  );

  for (const report of MOVEMENT_REPORTS) {
    server.registerTool(
      report.name,
      {
        title: report.title,
        description: `${report.description} Período YYYY-MM-DD, ambos inclusive. Con grouped=true, totales por ingrediente. Requiere plan premium. Solo lectura. ${UNTRUSTED_NOTE}`,
        inputSchema: {
          ...periodInput,
          grouped: z.boolean().default(false).describe('true: totales por ingrediente.'),
        },
        outputSchema: {
          period: periodOutput,
          lines: z.array(
            z.object({
              date: nullableText,
              item: nullableText,
              quantity: nullableNumber,
              unitPrice: nullableNumber,
              total: nullableNumber,
              from: nullableText.describe('Ubicación de origen (traslados).'),
              to: nullableText.describe('Ubicación de destino (traslados).'),
              note: nullableText,
            }),
          ),
          totals: z.object({ lines: z.number(), quantity: z.number(), total: z.number() }),
          truncated: z.boolean(),
        },
        annotations: READ_ONLY_ANNOTATIONS,
      },
      (args) =>
        runTool(ctx.logger, report.name, async () => {
          const period = isoPeriod(args, ctx.timeZone);
          const body = await ctx.restobar.read(report.op, {
            query: { dateInitISO: period.start, dateEndISO: period.end, groupResult: args.grouped },
          });
          const lines = rows(body).map(movementLine);
          return {
            period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
            lines: lines.slice(0, MAX_LINES),
            totals: {
              lines: lines.length,
              quantity: sum(lines.map((l) => l.quantity)),
              total: sum(lines.map((l) => l.total)),
            },
            truncated: lines.length > MAX_LINES,
          };
        }),
    );
  }
}
