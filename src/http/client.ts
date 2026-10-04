import { LoggroError } from '../errors.ts';
import { silentLogger, type Logger } from '../logging.ts';

/**
 * Operación de la API permitida explícitamente (allowlist). Cada una se declara
 * a mano con su página oficial; ver docs/architecture.md §6.
 */
export interface AllowedOperation {
  /** Identificador estable, p. ej. `restobar.listInvoices`. */
  readonly id: string;
  /** `read`: consulta de datos (solo GET). `auth`: obtención de token (único POST permitido). */
  readonly kind: 'read' | 'auth';
  readonly method: 'GET' | 'POST';
  /** Plantilla de ruta con parámetros `{nombre}`. */
  readonly path: string;
  /** Página oficial: https://developer.loggro.com/reference/<docSlug> */
  readonly docSlug: string;
}

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  pathParams?: Record<string, string>;
  query?: Record<string, QueryValue>;
  body?: unknown;
  token?: string;
}

/** Respuesta HTTP no exitosa. `apiMessage` es el campo `message` de Loggro, recortado. */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly apiMessage: string;

  constructor(status: number, apiMessage: string) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  allowlist: readonly AllowedOperation[];
  fetch?: typeof fetch;
  logger?: Logger;
  timeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 10_000;

/** Rechaza cualquier operación que no sea una consulta GET o el login. */
export function assertSafeOperation(op: AllowedOperation): void {
  const readOk = op.kind === 'read' && op.method === 'GET';
  const authOk = op.kind === 'auth' && op.method === 'POST';
  if (!readOk && !authOk) {
    throw new LoggroError('blocked', `Operación bloqueada: ${op.id} (${op.method}).`);
  }
  if (!op.path.startsWith('/') || /[?#]|\.\./.test(op.path)) {
    throw new LoggroError('blocked', `Ruta inválida en la allowlist: ${op.id}.`);
  }
}

export function buildUrl(
  baseUrl: string,
  pathTemplate: string,
  pathParams: Record<string, string> = {},
  query: Record<string, QueryValue> = {},
): URL {
  const path = pathTemplate.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = pathParams[name];
    if (value === undefined || value === '') {
      throw new LoggroError('bad_request', `Falta el parámetro de ruta «${name}».`);
    }
    // «.» y «..» sobreviven a encodeURIComponent y el parser de URL los resolvería,
    // saliendo de la ruta de la allowlist.
    if (value === '.' || value === '..') {
      throw new LoggroError('bad_request', `Parámetro de ruta inválido: «${name}».`);
    }
    return encodeURIComponent(value);
  });
  const base = new URL(baseUrl);
  const url = new URL(`${base.pathname.replace(/\/$/, '')}${path}`, base);
  if (url.origin !== base.origin) {
    throw new LoggroError('blocked', 'La URL resultante no pertenece al servidor configurado.');
  }
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new LoggroError('invalid_response', 'La respuesta de Restobar es demasiado grande.');
  }
  if (!res.body) return '';
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new LoggroError('invalid_response', 'La respuesta de Restobar es demasiado grande.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function extractApiMessage(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const { message } = body;
      if (typeof message === 'string') return message.slice(0, 300);
    }
  } catch {
    // Cuerpo no JSON: no se expone.
  }
  return '';
}

/** Código del error de red de `fetch` (Node lo pone en `cause.code`), sin otros detalles. */
function networkErrorCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === 'string' ? cause.code : undefined;
}

function retryDelayMs(res: Response | undefined, attempt: number): number {
  const retryAfter = Number(res?.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
  }
  return 500 * 2 ** attempt;
}

/**
 * Cliente HTTP mínimo sobre `fetch` nativo. Solo ejecuta operaciones de su
 * allowlist; reintenta únicamente consultas GET ante errores transitorios.
 */
export class HttpClient {
  private readonly allowed: ReadonlySet<AllowedOperation>;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HttpClientOptions) {
    options.allowlist.forEach(assertSafeOperation);
    this.allowed = new Set(options.allowlist);
    this.baseUrl = options.baseUrl;
    this.fetchFn = options.fetch ?? fetch;
    this.logger = options.logger ?? silentLogger;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxResponseBytes = options.maxResponseBytes ?? 5 * 1024 * 1024;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request(op: AllowedOperation, options: RequestOptions = {}): Promise<unknown> {
    if (!this.allowed.has(op)) {
      throw new LoggroError('blocked', `Operación fuera de la allowlist: ${op.id}.`);
    }
    assertSafeOperation(op);
    const url = buildUrl(this.baseUrl, op.path, options.pathParams, options.query);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const retries = op.method === 'GET' ? this.maxRetries : 0;

    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: op.method,
          headers,
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        // Nombre y código del error de red (p. ej. ECONNRESET, UND_ERR_CONNECT_TIMEOUT): sin URL,
        // cabeceras ni cuerpo, para poder diagnosticar en los logs del servidor.
        this.logger.warn('loggro.request.failed', {
          op: op.id,
          attempt,
          error: err instanceof Error ? err.name : typeof err,
          code: networkErrorCode(err),
          ms: Date.now() - started,
        });
        if (attempt < retries) {
          await this.sleep(retryDelayMs(undefined, attempt));
          continue;
        }
        throw new LoggroError(
          'unavailable',
          timedOut
            ? `Restobar no respondió en ${Math.round(this.timeoutMs / 1000)} segundos. Intenta con un rango de fechas o una página más pequeña.`
            : 'No fue posible conectar con Restobar.',
          { cause: err },
        );
      }
      this.logger.debug('loggro.request', {
        op: op.id,
        status: res.status,
        ms: Date.now() - started,
        attempt,
      });
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        await res.body?.cancel();
        await this.sleep(retryDelayMs(res, attempt));
        continue;
      }
      let text: string;
      try {
        text = await readLimited(res, this.maxResponseBytes);
      } catch (err) {
        if (err instanceof LoggroError) throw err;
        // La conexión se cortó o venció el tiempo mientras llegaba el cuerpo.
        this.logger.warn('loggro.response.failed', {
          op: op.id,
          status: res.status,
          error: err instanceof Error ? err.name : typeof err,
          code: networkErrorCode(err),
          ms: Date.now() - started,
        });
        throw new LoggroError('unavailable', 'La respuesta de Restobar se interrumpió.', {
          cause: err,
        });
      }
      if (!res.ok) throw new HttpStatusError(res.status, extractApiMessage(text));
      if (text.trim() === '') return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new LoggroError(
          'invalid_response',
          'Restobar devolvió una respuesta que no es JSON.',
        );
      }
    }
  }
}
