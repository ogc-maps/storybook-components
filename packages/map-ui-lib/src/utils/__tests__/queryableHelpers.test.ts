import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectGeometryTypesFromFeatures,
  buildDefaultStylesForGeometryTypes,
  isGeometryProperty,
  extractGeometryType,
  geometryTypeToStyleType,
  geometryTypeToStyleTypes,
  detectGeometryTypeFromQueryables,
  detectGeometryStyleTypesFromQueryables,
  getGeometryPropertyNames,
  toAvailableProperties,
  humanizePropertyName,
  detectStyleTypeForCollection,
  detectStyleTypesForCollection,
  resolveStyleReapplyAction,
} from '../queryableHelpers';
import type { StyleConfig } from '../../types';

function mockFetchSequence(...responses: Array<{ ok?: boolean; body: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.ok === false ? 500 : 200,
      statusText: r.ok === false ? 'Server Error' : 'OK',
      json: () => Promise.resolve(r.body),
    } as Response);
  }
  return fn;
}

describe('detectGeometryTypesFromFeatures', () => {
  it('returns empty array for empty features', () => {
    expect(detectGeometryTypesFromFeatures([])).toEqual([]);
  });

  it('returns distinct geometry types', () => {
    const features = [
      { geometry: { type: 'Point' } },
      { geometry: { type: 'Point' } },
      { geometry: { type: 'Polygon' } },
    ];
    const result = detectGeometryTypesFromFeatures(features);
    expect(result).toContain('Point');
    expect(result).toContain('Polygon');
    expect(result).toHaveLength(2);
  });

  it('handles null/undefined geometry', () => {
    const features = [
      { geometry: null },
      { geometry: { type: 'LineString' } },
      {},
    ];
    expect(detectGeometryTypesFromFeatures(features)).toEqual(['LineString']);
  });
});

describe('buildDefaultStylesForGeometryTypes', () => {
  it('returns empty array for unknown geometry types', () => {
    expect(buildDefaultStylesForGeometryTypes([])).toEqual([]);
    expect(buildDefaultStylesForGeometryTypes(['GeometryCollection'])).toEqual([]);
  });

  it('returns single fill style for polygon-only collection (no geometryFilter)', () => {
    const styles = buildDefaultStylesForGeometryTypes(['Polygon', 'MultiPolygon']);
    expect(styles).toHaveLength(1);
    expect(styles[0].type).toBe('fill');
    expect(styles[0].geometryFilter).toBeUndefined();
  });

  it('returns single circle style for point-only collection (no geometryFilter)', () => {
    const styles = buildDefaultStylesForGeometryTypes(['Point']);
    expect(styles).toHaveLength(1);
    expect(styles[0].type).toBe('circle');
    expect(styles[0].geometryFilter).toBeUndefined();
  });

  it('returns single line style for linestring-only collection (no geometryFilter)', () => {
    const styles = buildDefaultStylesForGeometryTypes(['LineString']);
    expect(styles).toHaveLength(1);
    expect(styles[0].type).toBe('line');
    expect(styles[0].geometryFilter).toBeUndefined();
  });

  it('returns multiple styles with geometryFilter for mixed collection', () => {
    const styles = buildDefaultStylesForGeometryTypes(['Polygon', 'Point']);
    expect(styles).toHaveLength(2);

    const fillStyle = styles.find((s) => s.type === 'fill');
    expect(fillStyle).toBeDefined();
    expect(fillStyle?.geometryFilter).toEqual(['Polygon', 'MultiPolygon']);

    const circleStyle = styles.find((s) => s.type === 'circle');
    expect(circleStyle).toBeDefined();
    expect(circleStyle?.geometryFilter).toEqual(['Point', 'MultiPoint']);
  });

  it('handles all three geometry families in mixed collection', () => {
    const styles = buildDefaultStylesForGeometryTypes(['Polygon', 'LineString', 'Point']);
    expect(styles).toHaveLength(3);
    expect(styles.map((s) => s.type)).toEqual(expect.arrayContaining(['fill', 'line', 'circle']));
    for (const style of styles) {
      expect(style.geometryFilter).toBeDefined();
    }
  });
});

describe('isGeometryProperty / extractGeometryType', () => {
  it('returns true for geometry $refs', () => {
    expect(
      isGeometryProperty({ $ref: 'https://geojson.org/schema/Point.json' }),
    ).toBe(true);
  });

  it('returns false when $ref is absent', () => {
    expect(isGeometryProperty({ type: 'string' })).toBe(false);
  });

  it('returns false for unrelated $refs', () => {
    expect(isGeometryProperty({ $ref: 'https://example.com/schema/Foo.json' })).toBe(false);
  });

  it('extracts geometry type from $ref URL', () => {
    expect(extractGeometryType('https://geojson.org/schema/Polygon.json')).toBe('Polygon');
    expect(extractGeometryType('https://geojson.org/schema/MultiLineString.json')).toBe('MultiLineString');
  });

  it('returns null for non-matching ref', () => {
    expect(extractGeometryType('https://example.com/Point')).toBeNull();
  });
});

describe('geometryTypeToStyleType', () => {
  it('maps Polygon → fill', () => {
    expect(geometryTypeToStyleType('Polygon')).toBe('fill');
    expect(geometryTypeToStyleType('MultiPolygon')).toBe('fill');
  });

  it('maps LineString → line', () => {
    expect(geometryTypeToStyleType('LineString')).toBe('line');
    expect(geometryTypeToStyleType('MultiLineString')).toBe('line');
  });

  it('maps Point → circle', () => {
    expect(geometryTypeToStyleType('Point')).toBe('circle');
  });

  it('returns null for unknown', () => {
    expect(geometryTypeToStyleType('GeometryCollection')).toBeNull();
    expect(geometryTypeToStyleType('Banana')).toBeNull();
  });
});

describe('geometryTypeToStyleTypes', () => {
  it('returns 3 styles for polygon', () => {
    expect(geometryTypeToStyleTypes('Polygon')).toEqual(['fill', 'line', 'symbol']);
  });

  it('returns 2 styles for linestring', () => {
    expect(geometryTypeToStyleTypes('LineString')).toEqual(['line', 'symbol']);
  });

  it('returns 2 styles for point', () => {
    expect(geometryTypeToStyleTypes('Point')).toEqual(['circle', 'symbol']);
  });

  it('returns empty array for unknown', () => {
    expect(geometryTypeToStyleTypes('Foo')).toEqual([]);
  });
});

describe('detectGeometryTypeFromQueryables', () => {
  it('detects Point queryable', () => {
    const queryables = {
      properties: {
        geom: { $ref: 'https://geojson.org/schema/Point.json' },
        name: { type: 'string' },
      },
    } as any;
    expect(detectGeometryTypeFromQueryables(queryables)).toBe('circle');
  });

  it('returns null when no geometry property present', () => {
    const queryables = {
      properties: { name: { type: 'string' } },
    } as any;
    expect(detectGeometryTypeFromQueryables(queryables)).toBeNull();
  });

  it('returns null when $ref does not match the geometry pattern', () => {
    const queryables = {
      properties: { foo: { $ref: 'https://example.com/foo.json' } },
    } as any;
    expect(detectGeometryTypeFromQueryables(queryables)).toBeNull();
  });
});

describe('detectGeometryStyleTypesFromQueryables', () => {
  it('returns 3 styles for Polygon queryable', () => {
    const queryables = {
      properties: { geom: { $ref: 'https://geojson.org/schema/Polygon.json' } },
    } as any;
    expect(detectGeometryStyleTypesFromQueryables(queryables)).toEqual(['fill', 'line', 'symbol']);
  });

  it('returns empty array when no geometry property', () => {
    expect(detectGeometryStyleTypesFromQueryables({ properties: {} } as any)).toEqual([]);
  });
});

describe('getGeometryPropertyNames', () => {
  it('returns names of geometry properties', () => {
    const queryables = {
      properties: {
        geom: { $ref: 'https://geojson.org/schema/Point.json' },
        name: { type: 'string' },
        shape: { $ref: 'https://geojson.org/schema/Polygon.json' },
      },
    } as any;
    expect(getGeometryPropertyNames(queryables).sort()).toEqual(['geom', 'shape']);
  });
});

describe('toAvailableProperties', () => {
  it('strips geometry properties and maps the rest', () => {
    const queryables = {
      properties: {
        geom: { $ref: 'https://geojson.org/schema/Point.json' },
        name: { type: 'string', title: 'Name' },
        pop: { type: 'integer', minimum: 0, maximum: 1e9 },
        category: { type: 'string', enum: ['a', 'b'] },
      },
    } as any;
    const props = toAvailableProperties(queryables);
    expect(props.map((p) => p.name).sort()).toEqual(['category', 'name', 'pop']);
    const pop = props.find((p) => p.name === 'pop');
    expect(pop?.minimum).toBe(0);
    expect(pop?.maximum).toBe(1e9);
    expect(props.find((p) => p.name === 'category')?.enum).toEqual(['a', 'b']);
  });
});

describe('humanizePropertyName', () => {
  it('handles snake_case', () => {
    expect(humanizePropertyName('pop_est')).toBe('Pop Est');
  });

  it('handles camelCase', () => {
    expect(humanizePropertyName('countryName')).toBe('Country Name');
  });

  it('handles single word', () => {
    expect(humanizePropertyName('name')).toBe('Name');
  });

  it('handles mixed', () => {
    expect(humanizePropertyName('first_nameValue')).toBe('First Name Value');
  });
});

// ─── Async detectors ────────────────────────────────────────────────────────

describe('detectStyleTypeForCollection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns style type from queryables when geometry $ref present', async () => {
    const queryables = {
      properties: { geom: { $ref: 'https://geojson.org/schema/Polygon.json' } },
    };
    vi.stubGlobal('fetch', mockFetchSequence({ body: queryables }));
    expect(await detectStyleTypeForCollection('https://api.example.com', 'roads')).toBe('fill');
  });

  it('falls back to fetching a feature when queryables lack geometry', async () => {
    const queryables = { properties: { name: { type: 'string' } } };
    const featureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point' }, properties: {} }],
    };
    vi.stubGlobal('fetch', mockFetchSequence(
      { body: queryables },
      { body: featureCollection },
    ));
    expect(await detectStyleTypeForCollection('https://api.example.com', 'roads')).toBe('circle');
  });

  it('returns null when feature has no geometry type', async () => {
    const queryables = { properties: {} };
    const featureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: {} }],
    };
    vi.stubGlobal('fetch', mockFetchSequence(
      { body: queryables },
      { body: featureCollection },
    ));
    expect(await detectStyleTypeForCollection('https://api.example.com', 'roads')).toBeNull();
  });

  it('falls back to features when queryables fetch fails', async () => {
    const featureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString' }, properties: {} }],
    };
    vi.stubGlobal('fetch', mockFetchSequence(
      { ok: false, body: {} },
      { body: featureCollection },
    ));
    expect(await detectStyleTypeForCollection('https://api.example.com', 'roads')).toBe('line');
  });

  it('returns null when both queryables and features fetches fail', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      { ok: false, body: {} },
      { ok: false, body: {} },
    ));
    expect(await detectStyleTypeForCollection('https://api.example.com', 'roads')).toBeNull();
  });
});

describe('detectStyleTypesForCollection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns style types from queryables when geometry $ref present', async () => {
    const queryables = {
      properties: { geom: { $ref: 'https://geojson.org/schema/Point.json' } },
    };
    vi.stubGlobal('fetch', mockFetchSequence({ body: queryables }));
    expect(await detectStyleTypesForCollection('https://api.example.com', 'cities'))
      .toEqual(['circle', 'symbol']);
  });

  it('falls back to feature scan and dedupes style types for mixed geometry', async () => {
    const queryables = { properties: {} };
    const featureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point' }, properties: {} },
        { type: 'Feature', geometry: { type: 'Polygon' }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point' }, properties: {} },
      ],
    };
    vi.stubGlobal('fetch', mockFetchSequence(
      { body: queryables },
      { body: featureCollection },
    ));
    const result = await detectStyleTypesForCollection('https://api.example.com', 'mixed');
    expect(result.sort()).toEqual(['circle', 'fill', 'line', 'symbol']);
  });

  it('returns empty array when both fetches fail', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      { ok: false, body: {} },
      { ok: false, body: {} },
    ));
    expect(await detectStyleTypesForCollection('https://api.example.com', 'cities')).toEqual([]);
  });
});

describe('resolveStyleReapplyAction', () => {
  const fill: StyleConfig = buildDefaultStylesForGeometryTypes(['Polygon'])[0];
  const circle: StyleConfig = buildDefaultStylesForGeometryTypes(['Point'])[0];

  it('applies detected styles when there are none yet', () => {
    expect(resolveStyleReapplyAction(undefined, [circle], null)).toBe('apply');
    expect(resolveStyleReapplyAction([], [circle], null)).toBe('apply');
  });

  it('keeps when nothing was detected', () => {
    expect(resolveStyleReapplyAction([fill], [], [fill])).toBe('keep');
  });

  it('keeps when current already equals detected', () => {
    expect(resolveStyleReapplyAction([circle], [circle], [fill])).toBe('keep');
  });

  it('re-applies when current styles are still the untouched auto-defaults (collection change)', () => {
    // Draft started on a polygon collection (fill), then switched to point (circle).
    // The current fill equals the last auto-applied fill, so it is safe to replace with circle.
    expect(resolveStyleReapplyAction([fill], [circle], [fill])).toBe('apply');
  });

  it('warns instead of clobbering when the user customized the styles', () => {
    const customized: StyleConfig = {
      ...fill,
      paint: { ...fill.paint, 'fill-color': '#123456' },
    };
    expect(resolveStyleReapplyAction([customized], [circle], [fill])).toBe('warn');
  });

  it('warns when styles exist but we never recorded an auto-applied set', () => {
    expect(resolveStyleReapplyAction([fill], [circle], null)).toBe('warn');
  });
});
