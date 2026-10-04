import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCashTools } from './cash.ts';
import { registerCatalogTools } from './catalog.ts';
import { registerClientBulkTools } from './clients-bulk.ts';
import { registerClientTools } from './clients.ts';
import type { RestobarToolContext } from './context.ts';
import { registerExpenseTools } from './expenses.ts';
import { registerInventoryTools } from './inventory.ts';
import { registerInvoiceTools } from './invoices.ts';
import { registerOrderTools } from './orders.ts';
import { registerReportTools } from './reports.ts';
import { registerSalesTools } from './sales.ts';
import { registerSettingsTools } from './settings.ts';

export type { RestobarToolContext } from './context.ts';

export function registerRestobarTools(server: McpServer, ctx: RestobarToolContext): void {
  registerInvoiceTools(server, ctx);
  registerCatalogTools(server, ctx);
  registerOrderTools(server, ctx);
  registerClientTools(server, ctx);
  registerClientBulkTools(server, ctx);
  registerSalesTools(server, ctx);
  registerReportTools(server, ctx);
  registerExpenseTools(server, ctx);
  registerInventoryTools(server, ctx);
  registerSettingsTools(server, ctx);
  registerCashTools(server, ctx);
}
