import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { RESTOBAR_OPERATIONS as OPS } from '../../loggro/restobar/operations.ts';
import {
  READ_ONLY_ANNOTATIONS,
  UNTRUSTED_NOTE,
  dayRangeToIso,
  pageInfo,
  paginationInput,
  paginationOutput,
  runTool,
  toRestobarPage,
} from '../shared.ts';
import type { RestobarToolContext } from './context.ts';
import {
  bool,
  isObject,
  nameMap,
  num,
  periodInput,
  refId,
  refName,
  rows,
  sum,
  text,
} from './extract.ts';

const nullableText = z.string().nullable();
const nullableNumber = z.number().nullable();

const OBJECT_ID = /^[0-9a-f]{24}$/;

const difference = (counted: number | null, system: number | null): number | null =>
  counted !== null && system !== null ? counted - system : null;

export function registerCashTools(server: McpServer, ctx: RestobarToolContext): void {
  server.registerTool(
    'restobar_list_cash_closings',
    {
      title: 'Cuadres de caja (Restobar)',
      description: [
        'Lista los cuadres (turnos) de caja de Restobar, del más reciente al más antiguo: apertura,',
        'cierre, estado, cajeros y, por método de pago, la base inicial, el valor del sistema, lo contado',
        'por el cajero y la diferencia (contado − sistema: negativa = faltante, positiva = sobrante).',
        'Filtra por estado (open = abierta, closed = cerrada) y por fecha de apertura. Sin plan premium,',
        'Restobar solo devuelve el último cuadre. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: {
        status: z.enum(['open', 'closed']).optional().describe('open = abierta; closed = cerrada.'),
        dateFrom: periodInput.dateFrom.optional(),
        dateTo: periodInput.dateTo.optional(),
        ...paginationInput,
      },
      outputSchema: {
        cashClosings: z.array(
          z.object({
            id: z.string(),
            number: nullableNumber.describe('Consecutivo del cuadre.'),
            isClosed: z.boolean().nullable(),
            openedOn: nullableText,
            closedOn: nullableText,
            cashiers: z.array(z.string()),
            paymentMethods: z.array(
              z.object({
                paymentMethod: nullableText,
                initial: nullableNumber.describe('Base inicial (totalInit).'),
                system: nullableNumber.describe('Valor según el sistema (totalNow).'),
                counted: nullableNumber.describe('Valor contado por el cajero (totalCashier).'),
                difference: nullableNumber.describe('counted − system.'),
              }),
            ),
            totals: z.object({
              initial: z.number(),
              system: z.number(),
              counted: z.number(),
              difference: z.number(),
            }),
            expenses: nullableNumber.describe('Gastos registrados en el turno.'),
            canceledInvoices: z.number().describe('Facturas anuladas en el turno.'),
          }),
        ),
        pagination: paginationOutput,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      runTool(ctx.logger, 'restobar_list_cash_closings', async () => {
        const range = dayRangeToIso(args.dateFrom, args.dateTo, ctx.timeZone);
        const body = await ctx.restobar.read(OPS.listCashClosings, {
          query: {
            pagination: true,
            ...toRestobarPage(args.page, args.pageSize),
            status: args.status,
            dateInit: range.start,
            dateEnd: range.end,
          },
        });
        const list = rows(body).filter((r) => r.deleted !== true);
        // El método de pago puede llegar como nombre, como ID o poblado.
        const needsNames = list.some(
          (r) =>
            Array.isArray(r.paymentMethods) &&
            r.paymentMethods.some((m) => isObject(m) && OBJECT_ID.test(String(m.paymentMethod))),
        );
        const methods = needsNames
          ? nameMap(await ctx.restobar.read(OPS.listPaymentMethods))
          : undefined;
        const cashClosings = list.map((r) => {
          const paymentMethods = (Array.isArray(r.paymentMethods) ? r.paymentMethods : [])
            .filter(isObject)
            .map((m) => {
              const pm = m.paymentMethod;
              const system = num(m.totalNow);
              const counted = num(m.totalCashier);
              return {
                paymentMethod:
                  typeof pm === 'string' && OBJECT_ID.test(pm) ? refName(pm, methods) : text(pm),
                initial: num(m.totalInit),
                system,
                counted,
                difference: difference(counted, system),
              };
            });
          return {
            id: refId(r) ?? '',
            number: num(r.seq),
            isClosed: bool(r.isClosed),
            openedOn: text(r.dateStart) ?? text(r.createdOn),
            closedOn: text(r.dateEnd),
            // Solo el nombre de cada cajero: el usuario completo trae datos de contacto.
            cashiers: (Array.isArray(r.cashiers) ? r.cashiers : [])
              .filter(isObject)
              .map((c) => text(c.name))
              .filter((n): n is string => n !== null),
            paymentMethods,
            totals: {
              initial: sum(paymentMethods.map((m) => m.initial)),
              system: sum(paymentMethods.map((m) => m.system)),
              counted: sum(paymentMethods.map((m) => m.counted)),
              difference: sum(paymentMethods.map((m) => m.difference)),
            },
            expenses: num(r.expense),
            canceledInvoices: Array.isArray(r.canceledInvoices) ? r.canceledInvoices.length : 0,
          };
        });
        return {
          cashClosings,
          pagination: pageInfo(
            args.page,
            args.pageSize,
            isObject(body) ? num(body.count) : null,
            list.length,
            'No recorras todas las páginas: filtra por fechas o estado.',
          ),
        };
      }),
  );
}
