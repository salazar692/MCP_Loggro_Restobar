import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { RESTOBAR_OPERATIONS as OPS } from '../../loggro/restobar/operations.ts';
import { READ_ONLY_ANNOTATIONS, UNTRUSTED_NOTE, runTool } from '../shared.ts';
import type { RestobarToolContext } from './context.ts';
import { at, bool, num, refId, rows, text, type Raw } from './extract.ts';

const nullableText = z.string().nullable();
const nullableNumber = z.number().nullable();

const active = (r: Raw): boolean => r.deleted !== true;

export function registerSettingsTools(server: McpServer, ctx: RestobarToolContext): void {
  server.registerTool(
    'restobar_list_tables',
    {
      title: 'Mesas (Restobar)',
      description:
        'Lista las mesas del negocio en Restobar (id, nombre, descripción, si es de domicilio y si está activa). El id sirve para filtrar facturas y pedidos por mesa. Solo lectura.',
      inputSchema: {},
      outputSchema: {
        tables: z.array(
          z.object({
            id: z.string(),
            name: nullableText,
            description: nullableText,
            isHomeDelivery: z.boolean().nullable(),
            isActive: z.boolean().nullable(),
          }),
        ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      runTool(ctx.logger, 'restobar_list_tables', async () => {
        const body = await ctx.restobar.read(OPS.listTables);
        // Las mesas traen `password` (clave de la mesa): nunca se copia.
        return {
          tables: rows(body)
            .filter(active)
            .map((r) => ({
              id: refId(r) ?? '',
              name: text(r.name),
              description: text(r.description),
              isHomeDelivery: bool(r.isHomeDelivery),
              isActive: bool(r.isActive),
            })),
        };
      }),
  );

  server.registerTool(
    'restobar_list_taxes',
    {
      title: 'Impuestos (Restobar)',
      description:
        'Lista los impuestos configurados en Restobar (nombre, porcentaje y tipo: Percentage, PerUnit o None). Solo lectura.',
      inputSchema: {},
      outputSchema: {
        taxes: z.array(
          z.object({
            id: z.string(),
            name: nullableText,
            percentage: nullableNumber,
            type: nullableText,
          }),
        ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      runTool(ctx.logger, 'restobar_list_taxes', async () => {
        const body = await ctx.restobar.read(OPS.listTaxes);
        return {
          taxes: rows(body)
            .filter(active)
            .map((r) => ({
              id: refId(r) ?? '',
              name: text(r.name),
              percentage: num(r.percentage),
              type: text(r.type),
            })),
        };
      }),
  );

  server.registerTool(
    'restobar_list_units',
    {
      title: 'Unidades de medida (Restobar)',
      description:
        'Lista las unidades de medida del inventario en Restobar (kg, litro, unidad…). Solo lectura.',
      inputSchema: {},
      outputSchema: { units: z.array(z.object({ id: z.string(), name: nullableText })) },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      runTool(ctx.logger, 'restobar_list_units', async () => {
        const body = await ctx.restobar.read(OPS.listUnits);
        return {
          units: rows(body)
            .filter(active)
            .map((r) => ({ id: refId(r) ?? '', name: text(r.name) })),
        };
      }),
  );

  server.registerTool(
    'restobar_list_promos',
    {
      title: 'Promociones (Restobar)',
      description: [
        'Lista las promociones configuradas en Restobar: nombre, tipo (Porcentaje, ProcentajeCantidad o',
        'Cantidad), si está activa, vigencia, días y si aplica en el menú digital. Solo lectura.',
        UNTRUSTED_NOTE,
      ].join(' '),
      inputSchema: {},
      outputSchema: {
        promos: z.array(
          z.object({
            id: z.string(),
            name: nullableText,
            description: nullableText,
            type: nullableText,
            isActive: z.boolean().nullable(),
            startsOn: nullableText,
            endsOn: nullableText,
            days: z.array(z.string()),
            isHappyHour: z.boolean().nullable(),
            forDigitalMenu: z.boolean().nullable(),
          }),
        ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      runTool(ctx.logger, 'restobar_list_promos', async () => {
        const body = await ctx.restobar.read(OPS.listPromos);
        return {
          promos: rows(body)
            .filter(active)
            .map((r) => {
              const days = at(r, 'dateSettings.days');
              return {
                id: refId(r) ?? '',
                name: text(r.name),
                description: text(r.description),
                type: text(r.type),
                isActive: bool(r.isActive),
                startsOn: text(at(r, 'dateSettings.date.start')),
                endsOn: text(at(r, 'dateSettings.date.final')),
                days: Array.isArray(days)
                  ? days.map(text).filter((d): d is string => d !== null)
                  : [],
                isHappyHour: bool(at(r, 'dateSettings.happyHours.isHappyHour')),
                forDigitalMenu: bool(r.forDigitalMenu),
              };
            }),
        };
      }),
  );
}
