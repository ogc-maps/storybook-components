import { describe, it, expect, vi } from 'vitest';
import {
  stripTrailingSlash,
  appendAuth,
  authHeaders,
  tileSizeFromTileJson,
  detectTileSourceType,
  buildGeometryFilter,
  getVectorTileUrl,
  getFilteredVectorTileUrl,
  getCql2FilteredVectorTileUrl,
  getImageryTileUrl,
  getTileJsonUrl,
  getVectorTileSourceKey,
  fetchCollections,
  fetchFeatures,
  fetchFeatureById,
  fetchQueryables,
  fetchCollectionDetail,
  fetchConformance,
  fetchTileJson,
  fetchFeatureCount,
  fetchDistinctValues,
  fetchDistinctValuesMulti,
  fetchGenericTileJson,
} from '../ogcApi';
import type { TileJson, SourceAuth } from '../ogcApi';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockFetchResponse(body: unknown, opts: Partial<Response> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    ...opts,
  } as Response);
}

function mockFetchError(status = 500, statusText = 'Internal Server Error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
  } as Response);
}

const BASE = 'https://api.example.com';
const HEADER_AUTH: SourceAuth = { type: 'header', name: 'Authorization', value: 'Bearer tok' };
const QUERY_AUTH: SourceAuth = { type: 'query_param', name: 'apikey', value: 'abc123' };

// ─── Pure helpers ───────────────────────────────────────────────────────────

describe('stripTrailingSlash', () => {
  it('removes a trailing slash', () => {
    expect(stripTrailingSlash('https://example.com/')).toBe('https://example.com');
  });

  it('leaves a URL without trailing slash unchanged', () => {
    expect(stripTrailingSlash('https://example.com')).toBe('https://example.com');
  });

  it('handles empty string', () => {
    expect(stripTrailingSlash('')).toBe('');
  });
});

describe('appendAuth', () => {
  it('returns URL unchanged when no auth provided', () => {
    expect(appendAuth('https://example.com')).toBe('https://example.com');
  });

  it('returns URL unchanged for header auth (not a query param)', () => {
    expect(appendAuth('https://example.com', HEADER_AUTH)).toBe('https://example.com');
  });

  it('appends query param with ? when URL has no params', () => {
    expect(appendAuth('https://example.com/tiles', QUERY_AUTH)).toBe(
      'https://example.com/tiles?apikey=abc123',
    );
  });

  it('appends query param with & when URL already has params', () => {
    expect(appendAuth('https://example.com/tiles?f=json', QUERY_AUTH)).toBe(
      'https://example.com/tiles?f=json&apikey=abc123',
    );
  });
});

describe('authHeaders', () => {
  it('returns empty object when no auth provided', () => {
    expect(authHeaders()).toEqual({});
  });

  it('returns empty object for query_param auth', () => {
    expect(authHeaders(QUERY_AUTH)).toEqual({});
  });

  it('returns header object for header auth', () => {
    expect(authHeaders(HEADER_AUTH)).toEqual({ Authorization: 'Bearer tok' });
  });
});

describe('tileSizeFromTileJson', () => {
  it('returns 512 when scale >= 2', () => {
    expect(tileSizeFromTileJson({ tilejson: '3.0.0', tiles: [], scale: 2 } as TileJson)).toBe(512);
  });

  it('returns 512 for string scale "2.000000"', () => {
    expect(tileSizeFromTileJson({ tilejson: '3.0.0', tiles: [], scale: '2.000000' } as TileJson)).toBe(512);
  });

  it('returns 256 when scale is 1', () => {
    expect(tileSizeFromTileJson({ tilejson: '3.0.0', tiles: [], scale: 1 } as TileJson)).toBe(256);
  });

  it('returns 256 when scale is not set', () => {
    expect(tileSizeFromTileJson({ tilejson: '3.0.0', tiles: [] } as TileJson)).toBe(256);
  });
});

describe('detectTileSourceType', () => {
  it('detects XYZ tile URL', () => {
    expect(detectTileSourceType('https://tiles.example.com/{z}/{x}/{y}.pbf')).toBe('xyz');
  });

  it('detects TileJSON URL (tilejson.json)', () => {
    expect(detectTileSourceType('https://example.com/tiles/tilejson.json')).toBe('tilejson');
  });

  it('detects TileJSON URL (tiles.json)', () => {
    expect(detectTileSourceType('https://example.com/tiles.json')).toBe('tilejson');
  });

  it('defaults to ogc-api for standard OGC URL', () => {
    expect(detectTileSourceType('https://example.com/collections/my-layer')).toBe('ogc-api');
  });

  it('detects MapLibre style URL (style.json)', () => {
    expect(detectTileSourceType('https://api.maptiler.com/maps/hybrid-v4/style.json')).toBe(
      'style',
    );
  });

  it('detects style URL with query string', () => {
    expect(
      detectTileSourceType('https://api.maptiler.com/maps/hybrid-v4/style.json?key=abc123'),
    ).toBe('style');
  });

  it('detects style URL with mixed case extension', () => {
    expect(detectTileSourceType('https://example.com/maps/basemap/Style.JSON')).toBe('style');
  });

  it('detects style URL with fragment', () => {
    expect(detectTileSourceType('https://example.com/style.json#layer-a')).toBe('style');
  });

  it('detects WMTS via service=WMTS query parameter', () => {
    expect(
      detectTileSourceType('https://example.com/ows?service=WMTS&request=GetCapabilities'),
    ).toBe('wmts');
  });

  it('detects WMTS via WMTSCapabilities.xml path (NASA GIBS style)', () => {
    expect(
      detectTileSourceType(
        'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml',
      ),
    ).toBe('wmts');
  });

  it('detects WMTS via /wmts/ path with GetCapabilities.xml', () => {
    expect(
      detectTileSourceType('https://example.com/wmts/epsg4326/best/GetCapabilities.xml'),
    ).toBe('wmts');
  });

  it('does not misclassify an OGC API URL as WMTS', () => {
    expect(detectTileSourceType('https://example.com/collections/parcels')).toBe('ogc-api');
  });
});

describe('buildGeometryFilter', () => {
  it('builds single-type filter', () => {
    expect(buildGeometryFilter(['Point'])).toEqual(['==', ['geometry-type'], 'Point']);
  });

  it('builds multi-type filter', () => {
    expect(buildGeometryFilter(['Point', 'LineString'])).toEqual([
      'in',
      ['geometry-type'],
      ['literal', ['Point', 'LineString']],
    ]);
  });
});

// ─── URL builders ───────────────────────────────────────────────────────────

describe('getVectorTileUrl', () => {
  it('builds standard tile URL', () => {
    expect(getVectorTileUrl(BASE, 'roads')).toBe(
      `${BASE}/collections/roads/tiles/WebMercatorQuad/{z}/{x}/{y}`,
    );
  });

  it('uses custom tileMatrixSetId', () => {
    expect(getVectorTileUrl(BASE, 'roads', 'WorldCRS84Quad')).toBe(
      `${BASE}/collections/roads/tiles/WorldCRS84Quad/{z}/{x}/{y}`,
    );
  });

  it('appends query_param auth', () => {
    const url = getVectorTileUrl(BASE, 'roads', 'WebMercatorQuad', QUERY_AUTH);
    expect(url).toContain('?apikey=abc123');
  });

  it('strips trailing slash from baseUrl', () => {
    expect(getVectorTileUrl(`${BASE}/`, 'roads')).toBe(
      `${BASE}/collections/roads/tiles/WebMercatorQuad/{z}/{x}/{y}`,
    );
  });
});

describe('getTileJsonUrl', () => {
  it('builds TileJSON URL', () => {
    expect(getTileJsonUrl(BASE, 'roads')).toBe(
      `${BASE}/collections/roads/tiles/WebMercatorQuad/tilejson.json`,
    );
  });

  it('appends auth', () => {
    expect(getTileJsonUrl(BASE, 'roads', 'WebMercatorQuad', QUERY_AUTH)).toContain('?apikey=abc123');
  });
});

describe('getFilteredVectorTileUrl', () => {
  it('builds URL without filter', () => {
    expect(getFilteredVectorTileUrl(BASE, 'roads')).toBe(
      `${BASE}/collections/roads/tiles/WebMercatorQuad/{z}/{x}/{y}`,
    );
  });

  it('appends property filter params', () => {
    const url = getFilteredVectorTileUrl(BASE, 'roads', { status: 'active' });
    expect(url).toContain('status=active');
  });

  it('skips empty filter object', () => {
    const url = getFilteredVectorTileUrl(BASE, 'roads', {});
    expect(url).not.toContain('?');
  });
});

describe('getCql2FilteredVectorTileUrl', () => {
  it('builds URL without filter', () => {
    expect(getCql2FilteredVectorTileUrl(BASE, 'roads')).toBe(
      `${BASE}/collections/roads/tiles/WebMercatorQuad/{z}/{x}/{y}`,
    );
  });

  it('appends CQL2 filter as query params', () => {
    const filter = { op: '=' as const, args: [{ property: 'status' }, 'active'] };
    const url = getCql2FilteredVectorTileUrl(BASE, 'roads', filter);
    expect(url).toContain('filter-lang=cql2-json');
    expect(url).toContain('filter=');
  });

  it('handles null filter', () => {
    const url = getCql2FilteredVectorTileUrl(BASE, 'roads', null);
    expect(url).not.toContain('filter');
  });
});

describe('getImageryTileUrl', () => {
  it('builds default OGC imagery URL', () => {
    const url = getImageryTileUrl(BASE, 'aerial');
    expect(url).toBe(`${BASE}/collections/aerial/map/tiles/WebMercatorQuad/{z}/{x}/{y}.png`);
  });

  it('uses custom tileUrlTemplate', () => {
    const template = 'https://tiles.example.com/{z}/{x}/{y}.png';
    expect(getImageryTileUrl(BASE, 'aerial', 'WebMercatorQuad', template)).toBe(template);
  });

  it('appends auth to custom template', () => {
    const template = 'https://tiles.example.com/{z}/{x}/{y}.png';
    const url = getImageryTileUrl(BASE, 'aerial', 'WebMercatorQuad', template, QUERY_AUTH);
    expect(url).toBe(`${template}?apikey=abc123`);
  });

  it('skips auth if custom template already contains auth param', () => {
    const template = 'https://tiles.example.com/{z}/{x}/{y}.png?apikey=existing';
    const url = getImageryTileUrl(BASE, 'aerial', 'WebMercatorQuad', template, QUERY_AUTH);
    expect(url).toBe(template);
  });
});

describe('getVectorTileSourceKey', () => {
  it('returns layerId when no filter', () => {
    expect(getVectorTileSourceKey('roads')).toBe('roads');
  });

  it('returns layerId with null filter', () => {
    expect(getVectorTileSourceKey('roads', null)).toBe('roads');
  });

  it('appends serialized filter', () => {
    const filter = { op: '=' as const, args: [{ property: 'status' }, 'active'] };
    const key = getVectorTileSourceKey('roads', filter);
    expect(key).toBe(`roads--${JSON.stringify(filter)}`);
  });
});

// ─── Async fetch functions ──────────────────────────────────────────────────

describe('fetchCollections', () => {

  it('fetches collections from the correct URL', async () => {
    const collections = [{ id: 'roads', links: [] }];
    vi.stubGlobal('fetch', mockFetchResponse({ collections }));

    const result = await fetchCollections(BASE);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/collections?f=json`,
      { headers: {} },
    );
    expect(result).toEqual(collections);
  });

  it('passes header auth', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({ collections: [] }));
    await fetchCollections(BASE, HEADER_AUTH);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/collections?f=json`,
      { headers: { Authorization: 'Bearer tok' } },
    );
  });

  it('appends query_param auth to URL', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({ collections: [] }));
    await fetchCollections(BASE, QUERY_AUTH);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('apikey=abc123'),
      expect.anything(),
    );
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', mockFetchError(500));
    await expect(fetchCollections(BASE)).rejects.toThrow('OGC API request failed: 500');
  });
});

describe('fetchFeatures', () => {

  const featureCollection = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: {}, properties: { name: 'A' } }],
    numberMatched: 1,
  };

  it('fetches features with default options', async () => {
    vi.stubGlobal('fetch', mockFetchResponse(featureCollection));
    const result = await fetchFeatures(BASE, 'roads');
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/collections/roads/items');
    expect(calledUrl).toContain('f=geojson');
    expect(result.features).toHaveLength(1);
  });

  it('applies bbox, limit, offset, properties, datetime params', async () => {
    vi.stubGlobal('fetch', mockFetchResponse(featureCollection));
    await fetchFeatures(BASE, 'roads', {
      bbox: [-180, -90, 180, 90],
      limit: 10,
      offset: 5,
      properties: ['name', 'type'],
      datetime: '2024-01-01/2024-12-31',
    });
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('bbox=-180%2C-90%2C180%2C90');
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('offset=5');
    expect(calledUrl).toContain('properties=name%2Ctype');
    expect(calledUrl).toContain('datetime=2024-01-01%2F2024-12-31');
  });

  it('applies sortby params', async () => {
    vi.stubGlobal('fetch', mockFetchResponse(featureCollection));
    await fetchFeatures(BASE, 'roads', {
      sortby: [
        { property: 'name', direction: 'asc' },
        { property: 'id', direction: 'desc' },
      ],
    });
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('sortby=%2Bname%2C-id');
  });

  it('applies CQL2 filter', async () => {
    vi.stubGlobal('fetch', mockFetchResponse(featureCollection));
    const cql2Filter = { op: '=' as const, args: [{ property: 'status' }, 'active'] };
    await fetchFeatures(BASE, 'roads', { cql2Filter });
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('filter-lang=cql2-json');
    expect(calledUrl).toContain('filter=');
  });

  it('applies legacy filter (key-value) when no CQL2 filter', async () => {
    vi.stubGlobal('fetch', mockFetchResponse(featureCollection));
    await fetchFeatures(BASE, 'roads', { filter: { status: 'active' } });
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('status=active');
    expect(calledUrl).not.toContain('filter-lang');
  });

  it('prefers CQL2 filter over legacy filter', async () => {
    vi.stubGlobal('fetch', mockFetchResponse(featureCollection));
    const cql2Filter = { op: '=' as const, args: [{ property: 'type' }, 'road'] };
    await fetchFeatures(BASE, 'roads', { cql2Filter, filter: { status: 'active' } });
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('filter-lang=cql2-json');
    expect(calledUrl).not.toContain('status=active');
  });

  it('throws on error', async () => {
    vi.stubGlobal('fetch', mockFetchError(404, 'Not Found'));
    await expect(fetchFeatures(BASE, 'nonexistent')).rejects.toThrow('404');
  });
});

describe('fetchFeatureById', () => {

  it('returns feature on success', async () => {
    const feature = { type: 'Feature', id: '1', geometry: {}, properties: { name: 'A' } };
    vi.stubGlobal('fetch', mockFetchResponse(feature));
    const result = await fetchFeatureById(BASE, 'roads', '1');
    expect(result).toEqual(feature);
  });

  it('returns null on error (e.g. 404)', async () => {
    vi.stubGlobal('fetch', mockFetchError(404, 'Not Found'));
    const result = await fetchFeatureById(BASE, 'roads', 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const result = await fetchFeatureById(BASE, 'roads', '1');
    expect(result).toBeNull();
  });
});

describe('fetchQueryables', () => {

  it('fetches queryables', async () => {
    const queryables = { type: 'object', properties: { name: { type: 'string' } } };
    vi.stubGlobal('fetch', mockFetchResponse(queryables));
    const result = await fetchQueryables(BASE, 'roads');
    expect(result).toEqual(queryables);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/collections/roads/queryables');
    expect(calledUrl).toContain('f=schemajson');
  });

  it('passes header auth', async () => {
    const queryables = { type: 'object', properties: {} };
    vi.stubGlobal('fetch', mockFetchResponse(queryables));
    await fetchQueryables(BASE, 'roads', HEADER_AUTH);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/collections/roads/queryables'),
      { headers: { Authorization: 'Bearer tok' } },
    );
  });

  it('appends query_param auth to URL', async () => {
    const queryables = { type: 'object', properties: {} };
    vi.stubGlobal('fetch', mockFetchResponse(queryables));
    await fetchQueryables(BASE, 'roads', QUERY_AUTH);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('apikey=abc123');
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', mockFetchError(403));
    await expect(fetchQueryables(BASE, 'roads')).rejects.toThrow('OGC API request failed: 403');
  });
});

describe('fetchCollectionDetail', () => {

  it('fetches collection detail', async () => {
    const collection = { id: 'roads', title: 'Roads', links: [] };
    vi.stubGlobal('fetch', mockFetchResponse(collection));
    const result = await fetchCollectionDetail(BASE, 'roads');
    expect(result).toEqual(collection);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/collections/roads?f=json');
  });

  it('passes header auth', async () => {
    const collection = { id: 'roads', title: 'Roads', links: [] };
    vi.stubGlobal('fetch', mockFetchResponse(collection));
    await fetchCollectionDetail(BASE, 'roads', HEADER_AUTH);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/collections/roads'),
      { headers: { Authorization: 'Bearer tok' } },
    );
  });

  it('appends query_param auth to URL', async () => {
    const collection = { id: 'roads', title: 'Roads', links: [] };
    vi.stubGlobal('fetch', mockFetchResponse(collection));
    await fetchCollectionDetail(BASE, 'roads', QUERY_AUTH);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('apikey=abc123');
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', mockFetchError(404));
    await expect(fetchCollectionDetail(BASE, 'roads')).rejects.toThrow('OGC API request failed: 404');
  });
});

describe('fetchConformance', () => {

  it('fetches conformance classes', async () => {
    const conformance = { conformsTo: ['http://www.opengis.net/spec/ogcapi-features-1/1.0'] };
    vi.stubGlobal('fetch', mockFetchResponse(conformance));
    const result = await fetchConformance(BASE);
    expect(result.conformsTo).toHaveLength(1);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/conformance?f=json');
  });
});

describe('fetchTileJson', () => {

  it('fetches TileJSON for a collection', async () => {
    const tileJson = { tilejson: '3.0.0', tiles: ['https://example.com/{z}/{x}/{y}.pbf'] };
    vi.stubGlobal('fetch', mockFetchResponse(tileJson));
    const result = await fetchTileJson(BASE, 'roads');
    expect(result.tiles).toHaveLength(1);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/tiles/WebMercatorQuad/tilejson.json');
  });
});

describe('fetchFeatureCount', () => {

  it('returns numberMatched from response', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({
      type: 'FeatureCollection',
      features: [],
      numberMatched: 42,
    }));
    const count = await fetchFeatureCount(BASE, 'roads');
    expect(count).toBe(42);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('limit=0');
  });

  it('returns null when numberMatched is absent', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({
      type: 'FeatureCollection',
      features: [],
    }));
    const count = await fetchFeatureCount(BASE, 'roads');
    expect(count).toBeNull();
  });
});

describe('fetchDistinctValues', () => {

  it('returns sorted distinct values from a single page', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: {}, properties: { status: 'active' } },
        { type: 'Feature', geometry: {}, properties: { status: 'inactive' } },
        { type: 'Feature', geometry: {}, properties: { status: 'active' } },
      ],
    }));
    const values = await fetchDistinctValues(BASE, 'roads', 'status');
    expect(values).toEqual(['active', 'inactive']);
  });

  it('ignores null and non-string values', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: {}, properties: { status: 'active' } },
        { type: 'Feature', geometry: {}, properties: { status: null } },
        { type: 'Feature', geometry: {}, properties: { status: 123 } },
      ],
    }));
    const values = await fetchDistinctValues(BASE, 'roads', 'status');
    expect(values).toEqual(['active']);
  });

  it('applies query filter as CQL2 like expression', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: {}, properties: { status: 'active' } }],
    }));
    await fetchDistinctValues(BASE, 'roads', 'status', { query: 'act' });
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('filter-lang=cql2-json');
    expect(calledUrl).toContain('like');
  });

  it('paginates when fetchAll is true', async () => {
    const page1 = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: {}, properties: { status: 'a' } },
        { type: 'Feature', geometry: {}, properties: { status: 'b' } },
      ],
      numberMatched: 3,
    };
    const page2 = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: {}, properties: { status: 'c' } },
      ],
      numberMatched: 3,
    };
    const mockFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page1) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page2) } as Response);
    vi.stubGlobal('fetch', mockFn);

    const values = await fetchDistinctValues(BASE, 'roads', 'status', {
      fetchAll: true,
      limit: 2,
    });
    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(values).toEqual(['a', 'b', 'c']);
  });

  it('respects maxFeatures cap during pagination', async () => {
    const page = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: {}, properties: { status: 'a' } },
        { type: 'Feature', geometry: {}, properties: { status: 'b' } },
        { type: 'Feature', geometry: {}, properties: { status: 'c' } },
      ],
    };
    // Mock returns 3 features per page with no numberMatched (server doesn't report total)
    vi.stubGlobal('fetch', mockFetchResponse(page));

    const values = await fetchDistinctValues(BASE, 'roads', 'status', {
      fetchAll: true,
      limit: 3,
      maxFeatures: 3,
    });
    // Should stop after first page since fetched (3) >= maxFeatures (3)
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(values).toEqual(['a', 'b', 'c']);
  });
});

describe('fetchDistinctValuesMulti', () => {

  it('returns an empty object when no properties are requested', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchDistinctValuesMulti(BASE, 'roads', []);
    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests all properties in one URL and dedupes per-property', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: {}, properties: { name: 'Main', class: 'arterial' } },
        { type: 'Feature', geometry: {}, properties: { name: 'Oak', class: 'arterial' } },
        { type: 'Feature', geometry: {}, properties: { name: 'Main', class: 'local' } },
      ],
    }));
    const result = await fetchDistinctValuesMulti(BASE, 'roads', ['name', 'class']);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('properties=name%2Cclass');
    expect(result.name).toEqual(['Main', 'Oak']);
    expect(result.class).toEqual(['arterial', 'local']);
  });

  it('ignores null and non-string property values', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: {}, properties: { name: 'Main', class: null } },
        { type: 'Feature', geometry: {}, properties: { name: null, class: 42 } },
      ],
    }));
    const result = await fetchDistinctValuesMulti(BASE, 'roads', ['name', 'class']);
    expect(result.name).toEqual(['Main']);
    expect(result.class).toEqual([]);
  });

  it('paginates until maxFeatures is reached and stops', async () => {
    const page = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: {}, properties: { name: 'a' } },
        { type: 'Feature', geometry: {}, properties: { name: 'b' } },
      ],
      numberMatched: 10,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page) } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDistinctValuesMulti(BASE, 'roads', ['name'], {
      pageSize: 2,
      maxFeatures: 4,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.name).toEqual(['a', 'b']);
  });

  it('short-circuits when a page returns fewer features than requested', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: {}, properties: { name: 'only' } }],
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDistinctValuesMulti(BASE, 'roads', ['name'], {
      pageSize: 500,
      maxFeatures: 5000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.name).toEqual(['only']);
  });
});

describe('fetchGenericTileJson', () => {

  it('fetches TileJSON from any URL', async () => {
    const tileJson = { tilejson: '3.0.0', tiles: ['https://tiles.example.com/{z}/{x}/{y}.pbf'] };
    vi.stubGlobal('fetch', mockFetchResponse(tileJson));
    const result = await fetchGenericTileJson('https://tiles.example.com/tilejson.json');
    expect(result).toEqual(tileJson);
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────

describe('error handling (fetchJson)', () => {

  it('throws with status code and URL in message', async () => {
    vi.stubGlobal('fetch', mockFetchError(403, 'Forbidden'));
    await expect(fetchCollections(BASE)).rejects.toThrow(
      /OGC API request failed: 403 Forbidden/,
    );
  });

  it('includes the request URL in the error message', async () => {
    vi.stubGlobal('fetch', mockFetchError(503, 'Service Unavailable'));
    await expect(fetchCollections(BASE)).rejects.toThrow(BASE);
  });
});
