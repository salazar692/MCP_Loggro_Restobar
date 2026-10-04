import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  READ_ONLY_ANNOTATIONS,
  UNTRUSTED_NOTE,
  pageInfo,
  paginationInput,
  paginationOutput,
  runTool,
  toRestobarPage,
} from '../shared.ts';
import type { Product } from '../../loggro/restobar/schemas.ts';
import type { RestobarToolContext } from './context.ts';

const nullableText = z.string().nullable();
const nullableNumber = z.number().nullable();

export const ProductOut = z.object({
  id: z.string(),
  name: nullableText,
  categoryId: nullableText,
  categoryName: nullableText,
  barcode: nullableText,
  type: nullableText.describe('Normal, Subproducto, Ingrediente o Combo.'),
  inventoryType: nullableText.describe('PerUnit (por unidad) o WithIngredients (por receta).'),
  price: nullableNumber.describe('Precio de venta general.'),
  isActive: z.boolean().nullable(),
  stock: nullableNumber.describe('Stock total.'),
  stockMinimum: nullableNumber,
  purchaseCost: nullableNumber.describe('Costo de compra.'),
  locations: z
    .array(
      z.object({
        locationId: nullableText,
        locationName: nullableText,
        isMain: z.boolean().nullable(),
        stock: nullableNumber,
        stockMinimum: nullableNumber,
        price: nullableNumber.describe('Precio de venta en esta ubicación, si difiere.'),
        taxName: nullableText,
        taxPercentage: nullableNumber,
      }),
    )
    .describe('Stock y precio por ubicación de inventario.'),
});

/** Producto de Restobar → salida MCP (también la usa restobar_get_product). */
export function toProductOut(p: Product): z.infer<typeof ProductOut> {
  return {
    id: p._id,
    name: p.name ?? null,
    categoryId: p.category?.id ?? null,
    categoryName: p.category?.name ?? null,
    barcode: p.barcode ?? null,
    type: p.type ?? null,
    inventoryType: p.inventoryType ?? null,
    price: p.price ?? null,
    isActive: p.isActive ?? null,
    stock: p.stock ?? null,
    stockMinimum: p.stockMinimum ?? null,
    purchaseCost: p.pricePurchase ?? null,
    locations: (p.locationsStock ?? []).map((l) => ({
      locationId: l.locationStock?.id ?? null,
      locationName: l.locationStock?.name ?? null,
      isMain: l.isMain ?? null,
      stock: l.stock ?? null,
      stockMinimum: l.stockMinimum ?? null,
      price: l.price ?? null,
      taxName: l.tax?.name ?? null,
      taxPercentage: l.tax?.percentage ?? null,
    })),
  };
}

export function registerCatalogTools(server: McpServer, ctx: RestobarToolContext): void {
  server.registerTool(
    'restobar_list_products',
    {
      title: 'Buscar productos (Restobar)',
      description: [
        'Busca productos del negocio en Restobar por nombre o código de barras y/o por categoría',
        '(categoryId de restobar_list_categories). Incluye stock total, stock mínimo, costo de compra',
        'y, por ubicación de inventario, stock y precio de venta. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: {
        search: z.string().min(1).optional().describe('Nombre o código de barras.'),
        categoryId: z.string().min(1).optional().describe('ID de la categoría.'),
        ...paginationInput,
      },
      outputSchema: { products: z.array(ProductOut), pagination: paginationOutput },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_list_products', async () => {
        const page = await ctx.restobar.listProducts({
          ...toRestobarPage(args.page, args.pageSize),
          name: args.search,
          categoryId: args.categoryId,
        });
        return {
          products: page.data.map(toProductOut),
          pagination: pageInfo(
            args.page,
            args.pageSize,
            page.count,
            page.data.length,
            'No recorras todas las páginas: afina con search o categoryId.',
          ),
        };
      }),
  );

  server.registerTool(
    'restobar_list_categories',
    {
      title: 'Listar categorías (Restobar)',
      description:
        'Lista las categorías activas de productos del negocio en Restobar (id y nombre). Solo lectura.',
      inputSchema: {},
      outputSchema: {
        categories: z.array(
          z.object({
            id: z.string(),
            name: nullableText,
            description: nullableText,
            isActive: z.boolean().nullable(),
          }),
        ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      runTool(ctx.logger, 'restobar_list_categories', async () => {
        const categories = await ctx.restobar.listCategories();
        return {
          categories: categories.map((c) => ({
            id: c._id,
            name: c.name ?? null,
            description: c.description ?? null,
            isActive: c.isActive ?? null,
          })),
        };
      }),
  );

  server.registerTool(
    'restobar_list_payment_methods',
    {
      title: 'Listar métodos de pago (Restobar)',
      description:
        'Lista los métodos de pago configurados en Restobar (p. ej. Efectivo o Tarjeta). Sirve para filtrar facturas por método de pago. Solo lectura.',
      inputSchema: {},
      outputSchema: { paymentMethods: z.array(z.object({ id: z.string(), name: nullableText })) },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      runTool(ctx.logger, 'restobar_list_payment_methods', async () => {
        const methods = await ctx.restobar.listPaymentMethods();
        return { paymentMethods: methods.map((m) => ({ id: m._id, name: m.name ?? null })) };
      }),
  );
}
