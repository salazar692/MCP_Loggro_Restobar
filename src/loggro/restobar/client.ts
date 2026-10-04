import type { z } from 'zod';

import { LoggroError, genericMessage, type LoggroErrorKind } from '../../errors.ts';
import {
  HttpStatusError,
  type AllowedOperation,
  type HttpClient,
  type QueryValue,
} from '../../http/client.ts';
import type { TokenProvider } from './auth.ts';
import { RESTOBAR_OPERATIONS as OPS } from './operations.ts';
import {
  Category,
  Client,
  DaySales,
  Invoice,
  Order,
  PaymentMethod,
  Product,
  parsePage,
  type Page,
} from './schemas.ts';

const NOT_FOUND = /no (fue )?encontrad|no existe/i;
const PLAN_LIMIT = /cuentas? gratis|últimos \d+ días|periodo de prueba/i;

/**
 * Traduce errores HTTP de Restobar. Restobar no usa los códigos de forma
 * consistente (p. ej. 401 o 500 para «no encontrado»), así que también se mira
 * el mensaje. Ver docs/loggro-api/README.md §2.4.
 */
export function mapRestobarError(err: unknown): unknown {
  if (!(err instanceof HttpStatusError)) return err;
  const msg = err.apiMessage;
  let kind: LoggroErrorKind;
  if (NOT_FOUND.test(msg) || err.status === 404) kind = 'not_found';
  else if (err.status === 401 && PLAN_LIMIT.test(msg)) kind = 'plan_limit';
  else if (err.status === 401) kind = 'auth';
  else if (err.status === 402) kind = 'premium';
  else if (err.status === 403) kind = 'forbidden';
  else if (err.status === 429) kind = 'rate_limited';
  else if (err.status === 400) kind = 'bad_request';
  else kind = 'unavailable';
  const detail = msg ? ` Restobar respondió: «${msg}».` : '';
  return new LoggroError(kind, `${genericMessage(kind)}${detail}`, { cause: err });
}

export interface PageQuery {
  page: number;
  limit: number;
}

export interface DateRangeQuery {
  dateInit?: string | undefined;
  dateEnd?: string | undefined;
}

type Query = Record<string, QueryValue>;

/**
 * Cliente de solo lectura de Restobar: un método por operación de la allowlist.
 * Los `page` recibidos ya están en la convención de Restobar (desde 0).
 */
export class RestobarClient {
  readonly #http: HttpClient;
  readonly #tokens: TokenProvider;

  constructor(http: HttpClient, tokens: TokenProvider) {
    this.#http = http;
    this.#tokens = tokens;
  }

  listInvoices(
    q: PageQuery &
      DateRangeQuery & {
        status?: string | undefined;
        type?: string | undefined;
        clientId?: string | undefined;
        number?: string | undefined;
        paymentMethodName?: string | undefined;
      },
  ): Promise<Page<Invoice>> {
    return this.#page(OPS.listInvoices, Invoice, {
      pagination: true,
      typeSort: 'desc',
      ...q,
    });
  }

  async getInvoice(id: string): Promise<Invoice> {
    const body = await this.#get(OPS.getInvoice, { pathParams: { id } });
    if (body === null) throw new LoggroError('not_found', genericMessage('not_found'));
    return this.#parse(Invoice, body);
  }

  listProducts(
    q: PageQuery & { name?: string | undefined; categoryId?: string | undefined },
  ): Promise<Page<Product>> {
    return this.#page(OPS.listProducts, Product, { pagination: true, ...q });
  }

  async getProduct(id: string): Promise<Product> {
    const body = await this.#get(OPS.getProduct, { pathParams: { id } });
    if (body === null) throw new LoggroError('not_found', genericMessage('not_found'));
    return this.#parse(Product, body);
  }

  async listCategories(): Promise<Category[]> {
    return this.#list(OPS.listCategories, Category);
  }

  listOrders(
    q: PageQuery &
      DateRangeQuery & {
        status?: string | undefined;
        tableId?: string | undefined;
        product?: string | undefined;
      },
  ): Promise<Page<Order>> {
    return this.#page(OPS.listOrders, Order, { pagination: true, ...q });
  }

  listClients(q: PageQuery & { filter?: string | undefined }): Promise<Page<Client>> {
    return this.#page(OPS.listClients, Client, { pagination: true, ...q });
  }

  async listPaymentMethods(): Promise<PaymentMethod[]> {
    return this.#list(OPS.listPaymentMethods, PaymentMethod);
  }

  async salesByDay(q: { dateInitISO: string; dateEndISO: string }): Promise<DaySales[]> {
    return this.#list(OPS.salesByDay, DaySales, q);
  }

  /**
   * Consulta de una operación de la allowlist con la respuesta sin validar: la herramienta que la usa
   * extrae campo por campo con lectores tolerantes. No acepta rutas libres, solo operaciones declaradas.
   */
  read(
    op: AllowedOperation,
    options: { query?: Query; pathParams?: Record<string, string> } = {},
  ): Promise<unknown> {
    return this.#get(op, options);
  }

  async #page<T extends z.ZodType>(
    op: AllowedOperation,
    item: T,
    query: Query,
  ): Promise<Page<z.infer<T>>> {
    const body = await this.#get(op, { query });
    const page = parsePage(item, body);
    if (!page) throw new LoggroError('invalid_response', genericMessage('invalid_response'));
    return page;
  }

  async #list<T extends z.ZodType>(
    op: AllowedOperation,
    item: T,
    query: Query = {},
  ): Promise<z.infer<T>[]> {
    const page = await this.#page(op, item, query);
    return page.data;
  }

  #parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new LoggroError('invalid_response', genericMessage('invalid_response'));
    }
    return parsed.data;
  }

  /** GET autenticado. Ante un 401 de sesión, renueva el token una sola vez (modo usuario y clave). */
  async #get(
    op: AllowedOperation,
    options: { query?: Query; pathParams?: Record<string, string> },
  ): Promise<unknown> {
    const token = await this.#tokens.getToken();
    try {
      return await this.#http.request(op, { ...options, token });
    } catch (err) {
      const sessionExpired =
        err instanceof HttpStatusError &&
        err.status === 401 &&
        !NOT_FOUND.test(err.apiMessage) &&
        !PLAN_LIMIT.test(err.apiMessage);
      if (!sessionExpired || !this.#tokens.invalidate(token)) throw mapRestobarError(err);
      const fresh = await this.#tokens.getToken();
      try {
        return await this.#http.request(op, { ...options, token: fresh });
      } catch (retryErr) {
        throw mapRestobarError(retryErr);
      }
    }
  }
}
