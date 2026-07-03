/**
 * Live integration tests: real ogr2ogr against a real PostGIS. Skipped unless
 * INGEST_INTEGRATION=1 (CI provides GDAL + a postgis service). Fixtures are
 * derived with ogr2ogr from a canonical EPSG:4326 GeoJSON so every import code
 * path is exercised end-to-end and the IngestResponse contract is asserted live.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Pool } from 'pg';
import { assertIngestResponse, isNeedsLayerResponse } from './contract.js';

const RUN = process.env.INGEST_INTEGRATION === '1';

const BASE_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'a', n: 1 }, geometry: { type: 'Point', coordinates: [-106.9, 38.5] } },
    { type: 'Feature', properties: { name: 'b', n: 2 }, geometry: { type: 'Point', coordinates: [-107.0, 38.6] } },
    { type: 'Feature', properties: { name: 'c', n: 3 }, geometry: { type: 'Point', coordinates: [-107.1, 38.7] } },
  ],
};

describe.runIf(RUN)('ingest integration (real ogr2ogr + PostGIS)', () => {
  let dir: string;
  let pool: Pool;
  // Lazily imported so the module's createPool reads INGEST_DB_* envs first.
  let app: import('express').Express;
  const created: string[] = [];

  const ogr = (...args: string[]) => execFileSync('ogr2ogr', args, { stdio: 'pipe' });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-fixtures-'));
    const geojson = path.join(dir, 'base.geojson');
    fs.writeFileSync(geojson, JSON.stringify(BASE_GEOJSON));

    // Derive every format from the canonical GeoJSON.
    ogr('-f', 'GPKG', path.join(dir, 'single.gpkg'), geojson, '-nln', 'places');
    ogr('-f', 'FlatGeobuf', path.join(dir, 'data.fgb'), geojson);
    ogr('-f', 'KML', path.join(dir, 'data.kml'), geojson);
    ogr('-f', 'CSV', path.join(dir, 'data.csv'), geojson, '-lco', 'GEOMETRY=AS_WKT');
    // Write the shapefile to a plain dir, then zip it — newer GDAL rejects
    // random-access writes into /vsizip.
    const shpDir = path.join(dir, 'shp');
    fs.mkdirSync(shpDir);
    ogr('-f', 'ESRI Shapefile', path.join(shpDir, 'places.shp'), geojson);
    execFileSync('zip', ['-j', path.join(dir, 'shp.zip'), ...fs.readdirSync(shpDir).map((f) => path.join(shpDir, f))], { stdio: 'pipe' });
    // Multi-layer GeoPackage.
    ogr('-f', 'GPKG', path.join(dir, 'multi.gpkg'), geojson, '-nln', 'roads');
    ogr('-f', 'GPKG', '-update', path.join(dir, 'multi.gpkg'), geojson, '-nln', 'rivers');
    // Aspatial CSV (no geometry column).
    fs.writeFileSync(path.join(dir, 'aspatial.csv'), 'id,name\n1,alpha\n2,beta\n');

    pool = new Pool({
      host: process.env.INGEST_DB_HOST ?? 'localhost',
      port: Number(process.env.INGEST_DB_PORT ?? 5432),
      database: process.env.INGEST_DB_NAME ?? 'gis',
      user: process.env.INGEST_DB_USER ?? 'postgres',
      password: process.env.INGEST_DB_PASSWORD ?? 'postgres',
    });
    await pool.query('CREATE SCHEMA IF NOT EXISTS uploads');
    ({ app } = await import('./index.js'));
  });

  afterAll(async () => {
    for (const t of created) {
      await pool.query(`DROP TABLE IF EXISTS uploads."${t}"`).catch(() => undefined);
    }
    await pool.end().catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function ingest(file: string, table: string, fields: Record<string, string> = {}) {
    created.push(table);
    let req = request(app).post('/ingest').field('table', table).field('schema', 'uploads');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', path.join(dir, file));
  }

  const cases: Array<[string, string, string, Record<string, string>]> = [
    ['GeoJSON', 'base.geojson', 'it_geojson', { format: 'geojson' }],
    ['GeoPackage', 'single.gpkg', 'it_gpkg', { format: 'gpkg' }],
    ['FlatGeobuf', 'data.fgb', 'it_fgb', { format: 'fgb' }],
    ['KML', 'data.kml', 'it_kml', { format: 'kml' }],
    ['CSV', 'data.csv', 'it_csv', { format: 'csv', srs: 'EPSG:4326' }],
    ['Shapefile zip', 'shp.zip', 'it_shp', { format: 'shp-zip' }],
  ];

  for (const [label, file, table, fields] of cases) {
    it(`ingests ${label} → uploads.${table} reprojected to 4326`, async () => {
      const res = await ingest(file, table, fields);
      expect(res.status).toBe(200);
      assertIngestResponse(res.body);
      expect(res.body.featureCount).toBe(3);
      expect(res.body.srid).toBe(4326);
      expect(res.body.format).toBe(fields.format);

      const { rows } = await pool.query(`SELECT ST_SRID(geom) AS srid, count(*)::int AS n FROM uploads."${table}" GROUP BY 1`);
      expect(rows[0].srid).toBe(4326);
      expect(rows[0].n).toBe(3);

      const idx = await pool.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname='uploads' AND tablename=$1 AND indexdef ILIKE '%gist%'`,
        [table],
      );
      expect(idx.rowCount).toBeGreaterThan(0);
    });
  }

  it('returns needsLayer for a multi-layer GeoPackage with no layer chosen', async () => {
    const res = await ingest('multi.gpkg', 'it_multi', { format: 'gpkg' });
    expect(res.status).toBe(400);
    expect(isNeedsLayerResponse(res.body)).toBe(true);
    expect(res.body.layers.map((l: { name: string }) => l.name).sort()).toEqual(['rivers', 'roads']);
  });

  it('imports the chosen sublayer from a multi-layer GeoPackage', async () => {
    const res = await ingest('multi.gpkg', 'it_multi_roads', { format: 'gpkg', layer: 'roads' });
    expect(res.status).toBe(200);
    assertIngestResponse(res.body);
    expect(res.body.featureCount).toBe(3);
  });

  it('rejects an aspatial file and leaves no table behind', async () => {
    const res = await ingest('aspatial.csv', 'it_aspatial', { format: 'csv' });
    expect(res.status).toBe(400);
    const reg = await pool.query(`SELECT to_regclass('uploads.it_aspatial') AS r`);
    expect(reg.rows[0].r).toBeNull();
  });

  it('honors the concurrency cap without crashing under parallel load', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => ingest('base.geojson', `it_conc_${i}`, { format: 'geojson' })),
    );
    // All either succeed or are cleanly rejected as busy (429) — never 500.
    for (const r of results) expect([200, 429]).toContain(r.status);
  });
});
