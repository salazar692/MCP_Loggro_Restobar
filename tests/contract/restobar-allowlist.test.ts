import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RESTOBAR_ALLOWLIST } from '../../src/loggro/restobar/operations.ts';

/**
 * Regla «no inventar»: cada operación permitida debe figurar en el inventario
 * generado desde la documentación oficial, con la clase esperada y la misma
 * página de referencia.
 */
const inventory = readFileSync(
  path.join(import.meta.dirname, '../../docs/loggro-api/inventory/restobar.md'),
  'utf8',
);

interface Row {
  cls: string;
  method: string;
  path: string;
  slug: string;
}

const rows: Row[] = inventory
  .split('\n')
  .filter(
    (line) => line.startsWith('| ') && !line.startsWith('| Clase') && !line.startsWith('| ---'),
  )
  .map((line) => {
    const cells = line.split(' | ').map((c) => c.replace(/^\| ?| ?\|$/g, '').trim());
    const slug =
      /\[([^\]]+)\]\(https:\/\/developer\.loggro\.com\/reference\//.exec(line)?.[1] ?? '';
    return {
      cls: cells[0] ?? '',
      method: cells[1] ?? '',
      path: (cells[2] ?? '').replace(/`/g, ''),
      slug,
    };
  });

describe('allowlist de Restobar frente al inventario oficial', () => {
  it('el inventario se pudo leer', () => {
    expect(rows.length).toBeGreaterThan(100);
  });

  it('una ruta real distinta de la documentada solo cambia el nombre, nunca el recurso', () => {
    for (const op of RESTOBAR_ALLOWLIST.filter((o) => o.documentedPath)) {
      const base = (p: string) =>
        p
          .toLowerCase()
          .split('/')[1]
          ?.replace(/ies$/, 'y')
          .replace(/(xes|s)$/, (m) => (m === 'xes' ? 'x' : ''));
      expect(base(op.path), op.id).toBe(base(op.documentedPath ?? ''));
    }
  });

  it.each(RESTOBAR_ALLOWLIST.map((op) => [op.id, op] as const))('%s', (_id, op) => {
    const documented = op.documentedPath ?? op.path;
    const row = rows.find((r) => r.method === op.method && r.path === documented);
    expect(row, `${op.method} ${documented} no está en el inventario`).toBeDefined();
    expect(row?.cls).toBe(op.kind === 'auth' ? 'autenticación' : 'lectura');
    expect(row?.slug).toBe(op.docSlug);
  });
});
