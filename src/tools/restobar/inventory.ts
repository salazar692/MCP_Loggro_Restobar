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
const MAX_ITEMS = 30;

/** Mapa id numérico → nombre de los tipos de movimiento. */
function typeMap(body: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows(body)) {
    const id = num(r.id) ?? num(r._id);
    const name = text(r.name);
    if (id !== null && name) map.set(String(id), name);
  }
  return map;
}

function direction(r: Raw): 'entrada' | 'salida' | 'producción' | 'traslado' | null {
  if (r.isMoveTo === true) return 'traslado';
  if (r.isProduction === true) return 'producción';
  if (r.isSubtracted === true) return 'salida';
  if (r.isSubtracted === false) return 'entrada';
  return null;
}

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

  server.registerTool(
    'restobar_list_inventory_movements',
    {
      title: 'Movimientos de inventario (Restobar)',
      description: [
        'Lista los movimientos de inventario de Restobar (entradas por compra, salidas, producción,',
        'traslados y ajustes): fecha, tipo, proveedor, factura de compra (número, total, pagado), total y',
        'los ítems movidos. Filtra por tipo (id de restobar_list_inventory_types), proveedor o número de',
        'factura. Las respuestas son pesadas: máximo 10 por página. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: {
        inventoryTypeId: z
          .number()
          .int()
          .optional()
          .describe('Tipo de movimiento (id numérico de restobar_list_inventory_types).'),
        providerId: z.string().min(1).optional().describe('ID del proveedor.'),
        invoiceNumber: z.string().min(1).optional().describe('Número de la factura de compra.'),
        page: paginationInput.page,
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe('Movimientos por página (1 a 10).'),
      },
      outputSchema: {
        movements: z.array(
          z.object({
            id: z.string(),
            date: nullableText,
            type: nullableText,
            direction: z
              .enum(['entrada', 'salida', 'producción', 'traslado'])
              .nullable()
              .describe('Según isSubtracted, isProduction e isMoveTo.'),
            provider: nullableText,
            invoiceNumber: nullableText,
            invoiceTotal: nullableNumber,
            invoicePaid: z.boolean().nullable(),
            invoiceTotalPaid: nullableNumber,
            total: nullableNumber,
            note: nullableText,
            itemCount: z.number(),
            items: z
              .array(
                z.object({
                  item: nullableText,
                  quantity: nullableNumber,
                  unitPrice: nullableNumber,
                }),
              )
              .describe(`Primeros ${MAX_ITEMS} ítems del movimiento.`),
          }),
        ),
        pagination: paginationOutput,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_list_inventory_movements', async () => {
        const body = await ctx.restobar.read(OPS.listInventoryMovements, {
          query: {
            pagination: true,
            ...toRestobarPage(args.page, args.pageSize),
            inventoryTypeId: args.inventoryTypeId,
            provider: args.providerId,
            inventoryNumber: args.invoiceNumber,
          },
        });
        const list = rows(body).filter((r) => r.deleted !== true);
        const typeNames = list.some((r) => !text(r.typeName))
          ? typeMap(await ctx.restobar.read(OPS.listInventoryTypes))
          : undefined;
        return {
          movements: list.map((r) => {
            const items = (Array.isArray(r.ingredients) ? r.ingredients : []).filter(isObject);
            return {
              id: refId(r) ?? '',
              date: text(r.date) ?? text(r.createdOn),
              type: text(r.typeName) ?? typeNames?.get(String(num(r.type))) ?? null,
              direction: direction(r),
              provider: refName(r.provider),
              invoiceNumber: text(at(r, 'invoice.invoiceNumber')),
              invoiceTotal: num(at(r, 'invoice.total')),
              invoicePaid: bool(at(r, 'invoice.isPaid')),
              invoiceTotalPaid: num(at(r, 'invoice.totalPaid')),
              total: num(r.total),
              note: text(r.note),
              itemCount: items.length,
              items: items.slice(0, MAX_ITEMS).map((i) => ({
                item: refName(i.ingredient) ?? refName(i.product),
                quantity: num(i.quantity),
                unitPrice: num(i.price),
              })),
            };
          }),
          pagination: pageInfo(
            args.page,
            args.pageSize,
            isObject(body) ? num(body.count) : null,
            list.length,
            'No recorras todas las páginas: filtra por tipo, proveedor o factura.',
          ),
        };
      }),
  );

  server.registerTool(
    'restobar_list_inventory_types',
    {
      title: 'Tipos de movimiento de inventario (Restobar)',
      description:
        'Lista los tipos de movimiento de inventario de Restobar (id numérico, nombre y si resta stock, es producción o es traslado). Sirve para filtrar restobar_list_inventory_movements. Solo lectura.',
      inputSchema: {},
      outputSchema: {
        inventoryTypes: z.array(
          z.object({
            id: nullableNumber,
            name: nullableText,
            subtractsStock: z.boolean().nullable(),
            isProduction: z.boolean().nullable(),
            isTransfer: z.boolean().nullable(),
          }),
        ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      runTool(ctx.logger, 'restobar_list_inventory_types', async () => {
        const body = await ctx.restobar.read(OPS.listInventoryTypes);
        return {
          inventoryTypes: rows(body).map((r) => ({
            id: num(r.id) ?? num(r._id),
            name: text(r.name),
            subtractsStock: bool(r.isSubtracted),
            isProduction: bool(r.isProduction),
            isTransfer: bool(r.isMoveTo),
          })),
        };
      }),
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
