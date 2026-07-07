import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { collectTableStats, dropTable } from './db.js';

function fakePool(rows: unknown[]): Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as Pool;
}

describe('collectTableStats', () => {
  it('parses geometry type, srid, count, and bbox from the stats row', async () => {
    const pool = fakePool([
      { n: 42, gt: 'MULTIPOLYGON', srid: 4326, minx: -105.1, miny: 38.2, maxx: -104.9, maxy: 38.5 },
    ]);
    const stats = await collectTableStats(pool, 'parcels');
    expect(stats).toEqual({
      geometryType: 'MULTIPOLYGON',
      srid: 4326,
      featureCount: 42,
      bbox: [-105.1, 38.2, -104.9, 38.5],
    });
  });

  it('defaults srid to 4326 and bbox to null when the table has no rows with geometry', async () => {
    const pool = fakePool([
      { n: 0, gt: null, srid: null, minx: null, miny: null, maxx: null, maxy: null },
    ]);
    const stats = await collectTableStats(pool, 'empty_table');
    expect(stats).toEqual({
      geometryType: null,
      srid: 4326,
      featureCount: 0,
      bbox: null,
    });
  });

  it('queries the uploads-schema-qualified, double-quoted table name', async () => {
    const pool = fakePool([{ n: 1, gt: 'POINT', srid: 4326, minx: 0, miny: 0, maxx: 0, maxy: 0 }]);
    await collectTableStats(pool, 'my_table');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('"uploads"."my_table"'));
  });

  it('rejects an unsafe table identifier before querying', async () => {
    const pool = fakePool([]);
    await expect(collectTableStats(pool, 'drop table users; --')).rejects.toThrow(
      /unsafe identifier/,
    );
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('dropTable', () => {
  it('issues a DROP TABLE IF EXISTS against the qualified table', async () => {
    const pool = fakePool([]);
    await dropTable(pool, 'stale_upload');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DROP TABLE IF EXISTS "uploads"."stale_upload"'),
    );
  });

  it('is a silent no-op for an unsafe identifier instead of throwing', async () => {
    const pool = fakePool([]);
    await expect(dropTable(pool, '"; DROP TABLE map_admin.map_configs; --')).resolves.toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
