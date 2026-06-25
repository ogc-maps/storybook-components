import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { inspectSourceClientSide, findNextLink } from '../inspectSource.js';

type FetchMock = ReturnType<typeof vi.fn>;

interface JsonResponseInit {
  status?: number;
  statusText?: string;
  ok?: boolean;
}

function jsonResponse(body: unknown, init: JsonResponseInit = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    statusText: init.statusText ?? 'OK',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Build a fetch mock keyed on URL substring.
 * Returns 404 for any URL not matched.
 */
function fetchByUrl(table: Array<{ match: string | RegExp; response: Response }>): FetchMock {
  return vi.fn(async (url: RequestInfo) => {
    const urlStr = String(url);
    for (const { match, response } of table) {
      if (typeof match === 'string' ? urlStr.includes(match) : match.test(urlStr)) {
        return response;
      }
    }
    return jsonResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' });
  });
}

describe('inspectSourceClientSide', () => {
  let fetchMock: FetchMock;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('OGC API source', () => {
    beforeEach(() => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance\?f=json$/,
          response: jsonResponse({
            conformsTo: [
              'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core',
              'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/oas30',
            ],
          }),
        },
        {
          match: /\/collections\?f=json$/,
          response: jsonResponse({
            collections: [
              {
                id: 'parcels',
                title: 'Parcels',
                description: 'County parcels',
                itemType: 'feature',
                extent: { spatial: { bbox: [[-180, -90, 180, 90]] } },
              },
            ],
          }),
        },
        {
          match: /\/collections\/parcels\/items\?limit=0/,
          response: jsonResponse({ numberMatched: 42 }),
        },
        {
          match: /\/collections\/parcels\/queryables/,
          response: jsonResponse({
            properties: {
              name: { type: 'string', title: 'Name', description: 'Parcel name' },
              area: { type: 'number', minimum: 0, maximum: 1000, format: 'double' },
              category: { type: 'string', enum: ['A', 'B', 'C'] },
            },
          }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({ title: 'tipg', description: 'tipg server' }),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
    });

    it('returns landing, conformance, collections', async () => {
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.landing).toEqual({ title: 'tipg', description: 'tipg server' });
      expect(result.conformance).toHaveLength(2);
      expect(result.collections).toHaveLength(1);
      const col = result.collections[0]!;
      expect(col.id).toBe('parcels');
      expect(col.title).toBe('Parcels');
      expect(col.itemCount).toBe(42);
      expect(col.itemType).toBe('feature');
      expect(col.queryables).toHaveLength(3);
      expect(col.queryables![0]).toMatchObject({ name: 'name', type: 'string', title: 'Name' });
      expect(col.queryables![1]).toMatchObject({ name: 'area', minimum: 0, maximum: 1000, format: 'double' });
      expect(col.queryables![2]?.enum).toEqual(['A', 'B', 'C']);
      expect(result.errors).toEqual([]);
    });

    it('normalizes URLs missing the scheme', async () => {
      await inspectSourceClientSide('localhost:8000');
      expect(fetchMock).toHaveBeenCalled();
      const calls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
      expect(calls.every((u: string) => u.startsWith('http://'))).toBe(true);
    });

    it('strips trailing slash from the base URL', async () => {
      await inspectSourceClientSide('http://localhost:8000/');
      const calls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
      // No URL should contain double slashes after the scheme
      for (const u of calls) {
        const afterScheme = u.replace(/^https?:\/\//, '');
        expect(afterScheme).not.toContain('//');
      }
    });

    it('produces an ISO timestamp', async () => {
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.inspectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('OGC API error paths', () => {
    it('returns null landing when landing fetch fails', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [] }),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.landing).toBeNull();
    });

    it('records a conformance error when /conformance returns non-array', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: 'not-an-array' }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [] }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.conformance).toBeNull();
      expect(result.conformanceError).toBeDefined();
    });

    it('captures conformance fetch failure', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ error: 'gone' }, { status: 500, statusText: 'Server Error' }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [] }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.conformance).toBeNull();
      expect(result.conformanceError).toMatch(/HTTP 500/);
    });

    it('records collections error when /collections format is wrong', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: 'not-an-array' }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.collections).toEqual([]);
      expect(result.errors.some((e) => /Collections/.test(e))).toBe(true);
    });

    it('captures item count fetch errors', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [{ id: 'c1' }] }),
        },
        {
          match: /\/collections\/c1\/queryables/,
          response: jsonResponse({ properties: {} }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
        // No match for items → 404
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.collections).toHaveLength(1);
      expect(result.collections[0]!.itemCount).toBeNull();
      expect(result.collections[0]!.itemCountError).toMatch(/HTTP 404/);
    });

    it('captures queryables fetch errors', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [{ id: 'c1' }] }),
        },
        {
          match: /\/collections\/c1\/items\?limit=0/,
          response: jsonResponse({ numberMatched: 0 }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
        // queryables 404
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.collections[0]!.queryables).toBeNull();
      expect(result.collections[0]!.queryablesError).toMatch(/HTTP 404/);
    });

    it('returns null queryables when properties is missing', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [{ id: 'c1' }] }),
        },
        {
          match: /\/collections\/c1\/items\?limit=0/,
          response: jsonResponse({ numberMatched: 0 }),
        },
        {
          match: /\/collections\/c1\/queryables/,
          response: jsonResponse({ /* no properties */ }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.collections[0]!.queryables).toBeNull();
    });

    it('uses numberReturned when numberMatched is missing', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [{ id: 'c1' }] }),
        },
        {
          match: /\/collections\/c1\/items\?limit=0/,
          response: jsonResponse({ numberReturned: 7 }),
        },
        {
          match: /\/collections\/c1\/queryables/,
          response: jsonResponse({ properties: {} }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.collections[0]!.itemCount).toBe(7);
    });

    it('returns null itemCount when neither numberMatched nor numberReturned is present', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [{ id: 'c1' }] }),
        },
        {
          match: /\/collections\/c1\/items\?limit=0/,
          response: jsonResponse({}),
        },
        {
          match: /\/collections\/c1\/queryables/,
          response: jsonResponse({ properties: {} }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.collections[0]!.itemCount).toBeNull();
      expect(result.collections[0]!.itemCountError).toBeUndefined();
    });

    it('coerces unexpected collection id to string', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [{ id: 42 }] }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.collections[0]!.id).toBe('42');
    });

    it('follows `next` links to gather all paginated collections', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        // Page 1 — first collection plus a `next` link to page 2.
        {
          match: /\/collections\?f=json$/,
          response: jsonResponse({
            collections: [{ id: 'page1-a' }],
            links: [
              {
                rel: 'next',
                type: 'application/json',
                href: 'http://localhost:8000/collections?f=json&offset=1',
              },
            ],
          }),
        },
        // Page 2 — second collection, no further `next`.
        {
          match: /\/collections\?f=json&offset=1$/,
          response: jsonResponse({
            collections: [{ id: 'page2-b' }],
            links: [{ rel: 'self', href: 'http://localhost:8000/collections?f=json&offset=1' }],
          }),
        },
        {
          match: /items\?limit=0/,
          response: jsonResponse({ numberMatched: 1 }),
        },
        {
          match: /queryables/,
          response: jsonResponse({ properties: {} }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      const ids = result.collections.map((c) => c.id).sort();
      expect(ids).toEqual(['page1-a', 'page2-b']);
    });

    it('handles many collections in batches of 5', async () => {
      const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: ids.map((id) => ({ id })) }),
        },
        {
          match: /items\?limit=0/,
          response: jsonResponse({ numberMatched: 1 }),
        },
        {
          match: /queryables/,
          response: jsonResponse({ properties: {} }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.collections).toHaveLength(12);
    });
  });

  describe('Auth header injection', () => {
    it('sends header auth on landing/collections/queryables requests', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections\?f=json/,
          response: jsonResponse({ collections: [{ id: 'c1' }] }),
        },
        {
          match: /\/collections\/c1\/items\?limit=0/,
          response: jsonResponse({ numberMatched: 1 }),
        },
        {
          match: /\/collections\/c1\/queryables/,
          response: jsonResponse({ properties: {} }),
        },
        {
          match: /\?f=json$/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      await inspectSourceClientSide('http://localhost:8000', {
        type: 'header',
        name: 'Authorization',
        value: 'Bearer xyz',
      });
      // Every call should carry the header
      for (const call of fetchMock.mock.calls) {
        const opts = call[1] as RequestInit;
        const headers = opts.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer xyz');
      }
    });

    it('appends query_param auth to the URL', async () => {
      fetchMock = fetchByUrl([
        {
          match: /\/conformance/,
          response: jsonResponse({ conformsTo: [] }),
        },
        {
          match: /\/collections/,
          response: jsonResponse({ collections: [] }),
        },
        {
          match: /\?/,
          response: jsonResponse({}),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      await inspectSourceClientSide('http://localhost:8000', {
        type: 'query_param',
        name: 'apikey',
        value: 'secret',
      });
      const calls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
      expect(calls.every((u: string) => u.includes('apikey=secret'))).toBe(true);
    });
  });

  describe('TileJSON source', () => {
    it('parses a valid TileJSON response', async () => {
      fetchMock = fetchByUrl([
        {
          match: 'tiles.json',
          response: jsonResponse({
            tilejson: '3.0.0',
            name: 'Parcels',
            description: 'Tile source',
            tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
            minzoom: 0,
            maxzoom: 14,
            bounds: [-180, -90, 180, 90],
            center: [0, 0, 5],
          }),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('https://example.com/tiles.json');
      expect(result.tileJson).toBeDefined();
      expect(result.tileJson!.tiles).toHaveLength(1);
      expect(result.tileJson!.minzoom).toBe(0);
      expect(result.tileJson!.maxzoom).toBe(14);
      expect(result.landing).toEqual({ title: 'Parcels', description: 'Tile source' });
      expect(result.errors).toEqual([]);
    });

    it('returns an error when tiles array is missing', async () => {
      fetchMock = fetchByUrl([
        {
          match: 'tilejson.json',
          response: jsonResponse({ tilejson: '3.0.0' }),
        },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('https://example.com/tilejson.json');
      expect(result.tileJson).toBeUndefined();
      expect(result.errors[0]).toMatch(/Invalid TileJSON/);
    });

    it('captures TileJSON fetch failures', async () => {
      fetchMock = fetchByUrl([
        // No matching route → 404
      ]);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('https://example.com/tilejson.json');
      expect(result.tileJson).toBeUndefined();
      expect(result.errors[0]).toMatch(/TileJSON fetch failed/);
    });
  });

  describe('XYZ source', () => {
    it('returns an empty result for XYZ tile URLs without fetching', async () => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('https://example.com/tiles/{z}/{x}/{y}.png');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.landing).toBeNull();
      expect(result.collections).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Style source', () => {
    it('returns an explanatory error for style URLs without fetching', async () => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('https://example.com/maps/light/style.json');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.errors[0]).toMatch(/Style URLs are not valid/);
    });
  });

  describe('Timeout / error handling', () => {
    it('reports "Request timed out" on AbortError', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      fetchMock = vi.fn().mockRejectedValue(abortErr);
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.landing).toBeNull();
      expect(result.conformanceError).toBe('Request timed out');
      expect(result.errors.some((e) => /Request timed out/.test(e))).toBe(true);
    });

    it('reports the error message for non-Error rejections', async () => {
      fetchMock = vi.fn().mockRejectedValue('boom');
      vi.stubGlobal('fetch', fetchMock);
      const result = await inspectSourceClientSide('http://localhost:8000');
      expect(result.conformanceError).toBe('boom');
    });
  });

  describe('findNextLink', () => {
    const base = 'http://localhost:8000/collections?f=json';

    it('returns null when links is not an array', () => {
      expect(findNextLink(undefined, base)).toBeNull();
      expect(findNextLink({}, base)).toBeNull();
    });

    it('returns null when there is no next link', () => {
      expect(findNextLink([{ rel: 'self', href: base }], base)).toBeNull();
    });

    it('returns the absolute href of a next link', () => {
      const next = findNextLink(
        [{ rel: 'next', type: 'application/json', href: base + '&offset=10' }],
        base,
      );
      expect(next).toBe(base + '&offset=10');
    });

    it('resolves a relative next href against the current page', () => {
      const next = findNextLink([{ rel: 'next', href: '/collections?f=json&offset=10' }], base);
      expect(next).toBe('http://localhost:8000/collections?f=json&offset=10');
    });

    it('prefers a json-typed next link over others', () => {
      const next = findNextLink(
        [
          { rel: 'next', type: 'text/html', href: base + '&html' },
          { rel: 'next', type: 'application/json', href: base + '&json' },
        ],
        base,
      );
      expect(next).toBe(base + '&json');
    });
  });
});
