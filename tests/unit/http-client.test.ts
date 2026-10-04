import { describe, expect, it } from 'vitest';

import { LoggroError } from '../../src/errors.ts';
import {
  HttpClient,
  HttpStatusError,
  buildUrl,
  type AllowedOperation,
} from '../../src/http/client.ts';
import { fakeFetch } from '../helpers/fake-fetch.ts';

const BASE = 'https://api.ejemplo.test';
const listOp: AllowedOperation = {
  id: 't.list',
  kind: 'read',
  method: 'GET',
  path: '/items/{id}',
  docSlug: 'x',
};
const loginOp: AllowedOperation = {
  id: 't.login',
  kind: 'auth',
  method: 'POST',
  path: '/login',
  docSlug: 'x',
};
const noSleep = () => Promise.resolve();

function client(handler: Parameters<typeof fakeFetch>[0], allowlist = [listOp, loginOp]) {
  const fake = fakeFetch(handler);
  const http = new HttpClient({ baseUrl: BASE, allowlist, fetch: fake.fetch, sleep: noSleep });
  return { http, calls: fake.calls };
}

describe('HttpClient: garantía de solo lectura', () => {
  it('rechaza en construcción una operación de lectura que no sea GET', () => {
    const writeOp = { ...listOp, id: 't.write', method: 'POST' } as const;
    expect(() => new HttpClient({ baseUrl: BASE, allowlist: [writeOp] })).toThrow(LoggroError);
  });

  it('rechaza métodos de escritura aunque se declaren como autenticación', () => {
    const del = { ...loginOp, id: 't.delete', method: 'DELETE' } as unknown as AllowedOperation;
    expect(() => new HttpClient({ baseUrl: BASE, allowlist: [del] })).toThrow(/bloqueada/);
  });

  it('bloquea operaciones fuera de la allowlist sin tocar la red', async () => {
    const { http, calls } = client(() => ({ body: {} }), [loginOp]);
    await expect(http.request(listOp, { pathParams: { id: '1' } })).rejects.toMatchObject({
      kind: 'blocked',
    });
    expect(calls).toHaveLength(0);
  });

  it('usa el método de la operación, no sigue redirecciones y envía el token', async () => {
    const { http, calls } = client(() => ({ body: { ok: true } }));
    await http.request(listOp, {
      pathParams: { id: 'a/b' },
      query: { q: 'x y', n: undefined },
      token: 'T',
    });
    expect(calls[0]).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(calls[0]?.url.href).toBe(`${BASE}/items/a%2Fb?q=x+y`);
    expect(calls[0]?.headers.Authorization).toBe('Bearer T');
  });
});

describe('HttpClient: reintentos y respuestas', () => {
  it('reintenta un GET ante 503 y devuelve el JSON', async () => {
    let n = 0;
    const { http, calls } = client(() => (++n === 1 ? { status: 503 } : { body: [1] }));
    await expect(http.request(listOp, { pathParams: { id: '1' } })).resolves.toEqual([1]);
    expect(calls).toHaveLength(2);
  });

  it('no reintenta el login (POST)', async () => {
    const { http, calls } = client(() => ({ status: 503 }));
    await expect(http.request(loginOp, { body: {} })).rejects.toBeInstanceOf(HttpStatusError);
    expect(calls).toHaveLength(1);
  });

  it('expone solo el campo message del error de Loggro', async () => {
    const { http } = client(() => ({ status: 403, body: { message: 'Sin permisos', extra: 'x' } }));
    await expect(http.request(listOp, { pathParams: { id: '1' } })).rejects.toMatchObject({
      status: 403,
      apiMessage: 'Sin permisos',
    });
  });

  it('rechaza respuestas que no son JSON o que superan el tamaño máximo', async () => {
    const { http } = client(() => ({ body: '<html>' }));
    await expect(http.request(listOp, { pathParams: { id: '1' } })).rejects.toMatchObject({
      kind: 'invalid_response',
    });
    const small = new HttpClient({
      baseUrl: BASE,
      allowlist: [listOp],
      fetch: fakeFetch(() => ({ body: { big: 'x'.repeat(100) } })).fetch,
      maxResponseBytes: 50,
    });
    await expect(small.request(listOp, { pathParams: { id: '1' } })).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('buildUrl', () => {
  it('distingue un tiempo de espera vencido de un fallo de red y registra el código', async () => {
    const warnings: Record<string, unknown>[] = [];
    const logger = {
      debug() {},
      info() {},
      warn: (_msg: string, fields?: Record<string, unknown>) => void warnings.push(fields ?? {}),
      error() {},
    };
    const failing = (err: Error) =>
      new HttpClient({
        baseUrl: BASE,
        allowlist: [listOp],
        fetch: () => Promise.reject(err),
        sleep: noSleep,
        maxRetries: 1,
        logger,
      });
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const timedOut = failing(timeout).request(listOp, { pathParams: { id: '1' } });
    await expect(timedOut).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(timedOut).rejects.toThrow(/no respondió en 20 segundos/);
    const network = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    await expect(
      failing(network).request(listOp, { pathParams: { id: '1' } }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'No fue posible conectar con Restobar.',
    });
    expect(warnings.at(-1)).toMatchObject({ op: 't.list', error: 'TypeError', code: 'ECONNRESET' });
    // Un intento más un reintento por cada solicitud.
    expect(warnings).toHaveLength(4);
  });

  it('exige los parámetros de ruta', () => {
    expect(() => buildUrl(BASE, '/items/{id}')).toThrow(/id/);
  });

  it('impide salir de la ruta permitida con segmentos «.» o «..»', () => {
    expect(() => buildUrl(BASE, '/items/{id}', { id: '..' })).toThrow(/inválido/);
    expect(() => buildUrl(BASE, '/items/{id}', { id: '.' })).toThrow(/inválido/);
    expect(buildUrl(BASE, '/items/{id}', { id: '../x' }).pathname).toBe('/items/..%2Fx');
  });
});
