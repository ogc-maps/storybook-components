import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  stripSchemaPrefix,
  parseVectorSourceLayer,
  getTileJsonUrlCandidates,
  fetchVectorSourceLayer,
  type TileJson,
} from '../ogcApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

function tileJson(vectorLayerIds: string[] | undefined): TileJson {
  return {
    tilejson: '3.0.0',
    tiles: ['https://x/{z}/{x}/{y}'],
    ...(vectorLayerIds ? { vector_layers: vectorLayerIds.map((id) => ({ id })) } : {}),
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Not Found', json: async () => body };
}

describe('stripSchemaPrefix', () => {
  it('strips a single schema qualifier', () => {
    expect(stripSchemaPrefix('gunnison.road')).toBe('road');
    expect(stripSchemaPrefix('ngfs_schema.ngfs_detections_scene_east_conus')).toBe(
      'ngfs_detections_scene_east_conus',
    );
  });
  it('passes through names without a dot (e.g. tipg custom "default")', () => {
    expect(stripSchemaPrefix('default')).toBe('default');
    expect(stripSchemaPrefix('road')).toBe('road');
  });
  it('only removes the first segment', () => {
    expect(stripSchemaPrefix('a.b.c')).toBe('b.c');
  });
});

describe('parseVectorSourceLayer', () => {
  it('returns the schema-stripped first vector_layers id', () => {
    expect(parseVectorSourceLayer(tileJson(['gunnison.road']))).toBe('road');
    expect(parseVectorSourceLayer(tileJson(['default']))).toBe('default');
  });
  it('returns null when no vector layers are declared', () => {
    expect(parseVectorSourceLayer(tileJson(undefined))).toBeNull();
    expect(parseVectorSourceLayer(tileJson([]))).toBeNull();
  });
});

describe('getTileJsonUrlCandidates', () => {
  it('offers both the /tiles/ and bare tilematrixset paths', () => {
    const urls = getTileJsonUrlCandidates('https://h/ogc/', 'gunnison.road', 'WebMercatorQuad');
    expect(urls).toEqual([
      'https://h/ogc/collections/gunnison.road/tiles/WebMercatorQuad/tilejson.json',
      'https://h/ogc/collections/gunnison.road/WebMercatorQuad/tilejson.json',
    ]);
  });
});

describe('fetchVectorSourceLayer', () => {
  it('reads the source-layer from the TileJSON (tipg case)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(tileJson(['gunnison.road']))));
    const result = await fetchVectorSourceLayer('https://a/ogc', 'gunnison.road');
    expect(result).toBe('road');
  });

  it('falls through to the second path when the first 404s (NOAA case)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'Not Found' }, false, 404))
      .mockResolvedValueOnce(jsonResponse(tileJson(['default'])));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchVectorSourceLayer('https://b/ogc', 'ngfs_schema.ngfs_detections_scene_east_conus');
    expect(result).toBe('default');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when no candidate yields a vector layer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(tileJson(undefined))));
    const result = await fetchVectorSourceLayer('https://c/ogc', 'foo.bar');
    expect(result).toBeNull();
  });

  it('caches a successful resolution per base+collection+tms', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(tileJson(['x.y'])));
    vi.stubGlobal('fetch', fetchMock);
    const a = await fetchVectorSourceLayer('https://d/ogc', 'x.y');
    const b = await fetchVectorSourceLayer('https://d/ogc', 'x.y');
    expect(a).toBe('y');
    expect(b).toBe('y');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a null result, so a later call retries (e.g. after a transient failure)', async () => {
    // First attempt: both candidate paths fail. Later attempt: TileJSON resolves.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 503))
      .mockResolvedValueOnce(jsonResponse({}, false, 503))
      .mockResolvedValue(jsonResponse(tileJson(['e.recovered'])));
    vi.stubGlobal('fetch', fetchMock);
    const first = await fetchVectorSourceLayer('https://e/ogc', 'e.recovered');
    expect(first).toBeNull();
    const second = await fetchVectorSourceLayer('https://e/ogc', 'e.recovered');
    expect(second).toBe('recovered');
  });
});
