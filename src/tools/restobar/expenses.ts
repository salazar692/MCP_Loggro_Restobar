import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { RESTOBAR_OPERATIONS as OPS } from '../../loggro/restobar/operations.ts';
import { READ_ONLY_ANNOTATIONS, UNTRUSTED_NOTE, personal, runTool } from '../shared.ts';
import type { RestobarToolContext } from './context.ts';
import {
  at,
  bool,
  inPeriod,
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

/** Máximo de registros por respuesta en listados sin paginación en la API. */
const MAX_ROWS = 200;

const isDeleted = (r: Raw): boolean =>
  r.deleted === true || at(r, 'deletedInfo.isDeleted') === true;

const truncatedOutput = z
  .boolean()
  .describe(`true si había más de ${MAX_ROWS} registros y solo se devuelven los primeros.`);

export function registerExpenseTools(server: McpServer, ctx: RestobarToolContext): void {
  const redact = ctx.redactPersonalData;

  server.registerTool(
    'restobar_list_expenses',
    {
      title: 'Gastos y egresos (Restobar)',
      description: [
        'Lista los gastos y egresos registrados en Restobar en un período (YYYY-MM-DD, ambos inclusive):',
        'fecha, tipo de gasto, descripción, proveedor o beneficiario, método de pago, subtotal, impuestos y',
        'total, más totales del período y por tipo de gasto. Útil para «gastos de la última semana».',
        'No incluye compras de inventario a proveedores (usa restobar_purchases_report). Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: {
        ...periodInput,
        expenseTypeId: z
          .string()
          .min(1)
          .optional()
          .describe('Solo este tipo de gasto (id de restobar_list_expense_types).'),
      },
      outputSchema: {
        period: periodOutput,
        expenses: z.array(
          z.object({
            id: z.string(),
            date: nullableText,
            expenseType: nullableText,
            description: nullableText,
            notes: nullableText,
            paidTo: nullableText.describe(
              'Beneficiario del pago (dato personal si es una persona).',
            ),
            provider: nullableText,
            paymentMethod: nullableText,
            invoiceNumber: nullableText,
            subTotal: nullableNumber,
            taxes: nullableNumber,
            total: nullableNumber.describe('subTotal + taxes.'),
            subtractedFromCashRegister: z
              .boolean()
              .nullable()
              .describe('Si el gasto se descontó del efectivo de la caja.'),
          }),
        ),
        totals: z.object({
          count: z.number(),
          subTotal: z.number(),
          taxes: z.number(),
          total: z.number(),
        }),
        byExpenseType: z.array(
          z.object({ expenseType: nullableText, count: z.number(), total: z.number() }),
        ),
        truncated: truncatedOutput,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_list_expenses', async () => {
        const period = isoPeriod(args, ctx.timeZone);
        const body = await ctx.restobar.read(OPS.listExpenses, {
          query: { dateInit: period.start, dateEnd: period.end },
        });
        const all = rows(body).filter(
          (r) =>
            !isDeleted(r) && (!args.expenseTypeId || refId(r.typeExpense) === args.expenseTypeId),
        );
        // Tipos y proveedores pueden llegar como ID: se resuelven con su catálogo solo si hace falta.
        const needs = (field: string): boolean =>
          all.some((r) => typeof r[field] === 'string' && r[field] !== '');
        const [types, providers] = await Promise.all([
          needs('typeExpense') ? ctx.restobar.read(OPS.listExpenseTypes).then(nameMap) : undefined,
          needs('provider') ? ctx.restobar.read(OPS.listProviders).then(nameMap) : undefined,
        ]);
        const expenses = all.map((r) => {
          const subTotal = num(r.subTotal);
          const taxes = num(r.taxes);
          return {
            id: refId(r) ?? '',
            date: text(r.date) ?? text(r.createdOn),
            expenseType: refName(r.typeExpense, types),
            description: text(r.description),
            notes: text(r.notes),
            paidTo: personal(text(r.paidTo), redact),
            provider: refName(r.provider, providers),
            paymentMethod: text(r.paymentMethod),
            invoiceNumber: text(r.invoiceNumber),
            subTotal,
            taxes,
            total: subTotal === null && taxes === null ? null : (subTotal ?? 0) + (taxes ?? 0),
            subtractedFromCashRegister: bool(r.subtractCashRegister),
          };
        });
        const byType = new Map<string | null, { count: number; total: number }>();
        for (const e of expenses) {
          const entry = byType.get(e.expenseType) ?? { count: 0, total: 0 };
          entry.count += 1;
          entry.total += e.total ?? 0;
          byType.set(e.expenseType, entry);
        }
        return {
          period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
          expenses: expenses.slice(0, MAX_ROWS),
          totals: {
            count: expenses.length,
            subTotal: sum(expenses.map((e) => e.subTotal)),
            taxes: sum(expenses.map((e) => e.taxes)),
            total: sum(expenses.map((e) => e.total)),
          },
          byExpenseType: [...byType]
            .map(([expenseType, v]) => ({ expenseType, ...v }))
            .sort((a, b) => b.total - a.total),
          truncated: expenses.length > MAX_ROWS,
        };
      }),
  );

  server.registerTool(
    'restobar_expenses_summary',
    {
      title: 'Total de gastos por tipo (Restobar)',
      description: [
        'Total de gastos de un período agrupado por tipo de gasto (subtotal, impuestos y total), según el',
        'reporte de utilidad por tipos de gasto de Restobar. Para ver cada gasto usa restobar_list_expenses.',
        'Solo lectura.',
      ].join(' '),
      inputSchema: periodInput,
      outputSchema: {
        period: periodOutput,
        byExpenseType: z.array(
          z.object({
            expenseType: nullableText,
            subTotal: nullableNumber.describe(
              'Hoy Restobar solo envía el total en este reporte: suele ser null.',
            ),
            taxes: nullableNumber.describe(
              'Hoy Restobar solo envía el total en este reporte: suele ser null.',
            ),
            total: z.number(),
          }),
        ),
        grandTotal: z.number(),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_expenses_summary', async () => {
        const period = isoPeriod(args, ctx.timeZone);
        const body = await ctx.restobar.read(OPS.reportUtilityByExpenseType, {
          query: { dateInitISO: period.start, dateEndISO: period.end },
        });
        const list = rows(body);
        const unnamed = list.some((r) => !text(r.typeExpenseName));
        const types = unnamed ? nameMap(await ctx.restobar.read(OPS.listExpenseTypes)) : undefined;
        const byExpenseType = list
          .map((r) => {
            const subTotal = num(r.totalSubTotal) ?? num(r.subTotal);
            const taxes = num(r.totalTaxes) ?? num(r.taxes);
            return {
              expenseType:
                text(r.typeExpenseName) ?? refName(at(r, '_id.typeExpense', 'typeExpense'), types),
              subTotal,
              taxes,
              total: num(r.total) ?? (subTotal ?? 0) + (taxes ?? 0),
            };
          })
          .sort((a, b) => b.total - a.total);
        return {
          period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
          byExpenseType,
          grandTotal: sum(byExpenseType.map((t) => t.total)),
        };
      }),
  );

  server.registerTool(
    'restobar_list_expense_types',
    {
      title: 'Tipos de gasto (Restobar)',
      description:
        'Lista los tipos de gasto configurados en Restobar (id y nombre). Sirve para filtrar restobar_list_expenses. Solo lectura.',
      inputSchema: {},
      outputSchema: { expenseTypes: z.array(z.object({ id: z.string(), name: nullableText })) },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      runTool(ctx.logger, 'restobar_list_expense_types', async () => {
        const body = await ctx.restobar.read(OPS.listExpenseTypes);
        return {
          expenseTypes: rows(body)
            .filter((r) => !isDeleted(r))
            .map((r) => ({ id: refId(r) ?? '', name: text(r.name) })),
        };
      }),
  );

  server.registerTool(
    'restobar_list_providers',
    {
      title: 'Proveedores (Restobar)',
      description: [
        'Lista los proveedores del negocio en Restobar: nombre, nombre comercial, documento y datos de',
        'contacto. Filtra por nombre con search. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: {
        search: z.string().min(1).optional().describe('Parte del nombre o nombre comercial.'),
      },
      outputSchema: {
        providers: z.array(
          z.object({
            id: z.string(),
            name: nullableText,
            tradeName: nullableText,
            document: nullableText,
            email: nullableText,
            phone: nullableText,
            address: nullableText,
            contact: nullableText,
            web: nullableText,
            note: nullableText,
          }),
        ),
        total: z.number(),
        truncated: truncatedOutput,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_list_providers', async () => {
        const body = await ctx.restobar.read(OPS.listProviders);
        const needle = args.search?.toLocaleLowerCase('es');
        const list = rows(body).filter(
          (r) =>
            !isDeleted(r) &&
            (!needle ||
              [text(r.name), text(r.tradename)].some((n) =>
                n?.toLocaleLowerCase('es').includes(needle),
              )),
        );
        return {
          providers: list.slice(0, MAX_ROWS).map((r) => ({
            id: refId(r) ?? '',
            name: text(r.name),
            tradeName: text(r.tradename),
            document: personal(text(r.document), redact),
            email: personal(text(r.email), redact),
            phone: personal(text(r.phone), redact),
            address: personal(text(r.address), redact),
            contact: personal(text(r.contact), redact),
            web: text(r.web),
            note: text(r.note),
          })),
          total: list.length,
          truncated: list.length > MAX_ROWS,
        };
      }),
  );

  server.registerTool(
    'restobar_list_purchase_payments',
    {
      title: 'Pagos de compras de inventario (Restobar)',
      description: [
        'Lista los pagos registrados a facturas de compra de inventario (a proveedores): fecha, descripción,',
        'valor y si se descontó de la caja. Con dateFrom y dateTo filtra por fecha de registro. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: {
        dateFrom: periodInput.dateFrom.optional(),
        dateTo: periodInput.dateTo.optional(),
      },
      outputSchema: {
        payments: z.array(
          z.object({
            id: z.string(),
            date: nullableText,
            description: nullableText,
            total: nullableNumber,
            subtractedFromCashRegister: z.boolean().nullable(),
            inventoryMovementId: nullableText,
          }),
        ),
        totals: z.object({ count: z.number(), total: z.number() }),
        truncated: truncatedOutput,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_list_purchase_payments', async () => {
        const period =
          args.dateFrom && args.dateTo
            ? isoPeriod({ dateFrom: args.dateFrom, dateTo: args.dateTo }, ctx.timeZone)
            : undefined;
        const body = await ctx.restobar.read(OPS.listPurchasePayments);
        const payments = rows(body)
          .filter((r) => !isDeleted(r) && (!period || inPeriod(r.createdOn, period)))
          .map((r) => ({
            id: refId(r) ?? '',
            date: text(r.createdOn),
            description: text(r.description),
            total: num(r.total),
            subtractedFromCashRegister: bool(r.subtractCashRegister),
            inventoryMovementId: refId(r.inventory),
          }))
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
        return {
          payments: payments.slice(0, MAX_ROWS),
          totals: { count: payments.length, total: sum(payments.map((p) => p.total)) },
          truncated: payments.length > MAX_ROWS,
        };
      }),
  );

  server.registerTool(
    'restobar_purchases_report',
    {
      title: 'Compras a proveedores (Restobar)',
      description: [
        'Reporte de compras de inventario de un período: por cada línea, fecha, proveedor, número y total',
        'de la factura de compra, ingrediente o producto, cantidad y precio. Incluye totales y compras por',
        'proveedor. Requiere plan premium. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: periodInput,
      outputSchema: {
        period: periodOutput,
        lines: z.array(
          z.object({
            date: nullableText,
            provider: nullableText,
            invoiceNumber: nullableText,
            invoiceTotal: nullableNumber,
            item: nullableText,
            quantity: nullableNumber,
            unitPrice: nullableNumber,
            lineTotal: nullableNumber.describe('quantity × unitPrice.'),
          }),
        ),
        byProvider: z.array(
          z.object({
            provider: nullableText,
            invoices: z.number(),
            total: z.number().describe('Suma de los totales de sus facturas de compra.'),
          }),
        ),
        totals: z.object({
          lines: z.number(),
          invoices: z.number(),
          invoicesTotal: z.number().describe('Suma de los totales de las facturas de compra.'),
          linesTotal: z.number(),
        }),
        truncated: truncatedOutput,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_purchases_report', async () => {
        const period = isoPeriod(args, ctx.timeZone);
        const body = await ctx.restobar.read(OPS.reportPurchases, {
          query: { dateInitISO: period.start, dateEndISO: period.end },
        });
        const lines = rows(body, 'purchases').map((r) => {
          const quantity = num(at(r, 'ingredient.quantity', 'quantity'));
          const unitPrice = num(at(r, 'ingredient.price', 'price'));
          return {
            date: text(r.date) ?? text(r.createdOn),
            provider: text(at(r, 'provider.name', 'provider.tradename')) ?? text(r.provider),
            invoiceNumber: text(at(r, 'invoice.invoiceNumber', 'invoiceNumber')),
            invoiceTotal: num(at(r, 'invoice.total', 'total')),
            item: text(at(r, 'ingredient.name', 'product.name', 'name')),
            quantity,
            unitPrice,
            lineTotal: quantity !== null && unitPrice !== null ? quantity * unitPrice : null,
          };
        });
        // Una factura de compra aparece en varias líneas: se cuenta una vez por proveedor y número.
        const invoices = new Map<string, { provider: string | null; total: number }>();
        for (const l of lines) {
          const key = `${l.provider ?? ''}|${l.invoiceNumber ?? l.date ?? ''}`;
          if (!invoices.has(key))
            invoices.set(key, { provider: l.provider, total: l.invoiceTotal ?? 0 });
        }
        const byProvider = new Map<string | null, { invoices: number; total: number }>();
        for (const inv of invoices.values()) {
          const entry = byProvider.get(inv.provider) ?? { invoices: 0, total: 0 };
          entry.invoices += 1;
          entry.total += inv.total;
          byProvider.set(inv.provider, entry);
        }
        return {
          period: { dateFrom: args.dateFrom, dateTo: args.dateTo },
          lines: lines.slice(0, MAX_ROWS),
          byProvider: [...byProvider]
            .map(([provider, v]) => ({ provider, ...v }))
            .sort((a, b) => b.total - a.total),
          totals: {
            lines: lines.length,
            invoices: invoices.size,
            invoicesTotal: sum([...invoices.values()].map((i) => i.total)),
            linesTotal: sum(lines.map((l) => l.lineTotal)),
          },
          truncated: lines.length > MAX_ROWS,
        };
      }),
  );
}
