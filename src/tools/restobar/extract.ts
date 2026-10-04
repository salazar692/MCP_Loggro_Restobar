import { z } from 'zod';

import { LoggroError } from '../../errors.ts';
import { dateInput, dayRangeToIso } from '../shared.ts';

/*
 * Lectores tolerantes para las respuestas de Restobar que no tienen esquema Zod propio. Loggro no
 * publica esquemas de respuesta fiables (ver docs/restobar-data-map.md): un campo puede llegar como
 * ID en texto o poblado como objeto, ausente o con otro tipo. Estos lectores nunca lanzan: devuelven
 * `null` y la herramienta copia campo por campo solo lo que declara en su `outputSchema`.
 */

export type Raw = Record<string, unknown>;

export function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Texto no vacío, o el `name` de una referencia poblada. */
export function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number') return String(v);
  if (isObject(v)) return text(v.name);
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/** ID de una referencia: texto (ID) u objeto poblado (`_id`, `id` o `idInternal`). */
export function refId(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (isObject(v)) return text(v._id) ?? text(v.id) ?? text(v.idInternal);
  return null;
}

/** Nombre de una referencia poblada; si llega solo el ID, lo busca en `names`. */
export function refName(v: unknown, names?: ReadonlyMap<string, string>): string | null {
  if (isObject(v)) return text(v.name);
  const id = refId(v);
  return id ? (names?.get(id) ?? null) : null;
}

/** Primer valor de la ruta `a.b.c` que no sea `undefined`. */
export function at(v: unknown, ...paths: string[]): unknown {
  for (const p of paths) {
    let cur: unknown = v;
    for (const key of p.split('.')) cur = isObject(cur) ? cur[key] : undefined;
    if (cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

/**
 * Filas de una respuesta: el arreglo mismo, o el primer arreglo dentro de las claves dadas (Restobar
 * envuelve algunos reportes, p. ej. `{ reportByProduct: [...] }` o `{ data: [...] }`).
 */
export function rows(body: unknown, ...keys: string[]): Raw[] {
  const list = Array.isArray(body)
    ? body
    : isObject(body)
      ? ([...keys, 'data'].map((k) => body[k]).find(Array.isArray) ??
        Object.values(body).find(Array.isArray) ??
        [])
      : [];
  return (list as unknown[]).filter(isObject);
}

/** Mapa ID → nombre de un catálogo (`[{ _id, name }]`). */
export function nameMap(body: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows(body)) {
    const id = refId(r);
    const name = text(r.name);
    if (id && name) map.set(id, name);
  }
  return map;
}

export const sum = (values: (number | null)[]): number =>
  values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

// ---------------------------------------------------------------------------
// Períodos: obligatorios en reportes y estadísticas.
// ---------------------------------------------------------------------------

export const periodInput = {
  dateFrom: dateInput.describe(
    'Desde esta fecha, inclusive (YYYY-MM-DD, zona horaria del negocio).',
  ),
  dateTo: dateInput.describe('Hasta esta fecha, inclusive (YYYY-MM-DD, zona horaria del negocio).'),
};

export const periodOutput = z.object({ dateFrom: z.string(), dateTo: z.string() });

/** Instantes ISO del período (00:00:00.000 a 23:59:59.999 locales). */
export function isoPeriod(
  args: { dateFrom: string; dateTo: string },
  timeZone: string,
): { start: string; end: string } {
  const { start, end } = dayRangeToIso(args.dateFrom, args.dateTo, timeZone);
  if (!start || !end) throw new LoggroError('bad_request', 'Indica dateFrom y dateTo.');
  return { start, end };
}

/** ¿El instante ISO `v` cae dentro del período? */
export function inPeriod(v: unknown, period: { start: string; end: string }): boolean {
  return typeof v === 'string' && v >= period.start && v <= period.end;
}

// ---------------------------------------------------------------------------
// Filas agrupadas de las estadísticas (`/stats/*`).
// ---------------------------------------------------------------------------

/**
 * Restobar agrupa con MongoDB: la etiqueta del grupo puede venir en el campo mismo (`product`), dentro
 * de `_id` (`_id.product`, `_id.name`) o como `_id` en texto. Se prueba en ese orden.
 */
export function groupLabel(row: Raw, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = text(row[key]) ?? text(at(row, `_id.${key}`));
    if (value) return value;
  }
  return (
    text(at(row, '_id.name')) ?? (typeof row._id === 'string' ? row._id : null) ?? text(row.name)
  );
}

export function groupNumber(row: Raw, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = num(row[key]) ?? num(at(row, `_id.${key}`));
    if (value !== null) return value;
  }
  return null;
}
