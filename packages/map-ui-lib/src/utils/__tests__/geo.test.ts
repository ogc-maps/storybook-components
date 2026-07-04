import { describe, it, expect } from 'vitest';
import {
  applyZoomInstruction,
  bboxFromGeometry,
  combineGeometries,
  featureCollectionFromGeometries,
  zoomToFeature,
  DEFAULT_POINT_ZOOM,
  DEFAULT_POLYGON_MAX_ZOOM,
} from '../geo';

describe('bboxFromGeometry', () => {
  it('pads a bare Point so min/max differ', () => {
    const bbox = bboxFromGeometry({ type: 'Point', coordinates: [-122, 37] });
    expect(bbox).not.toBeNull();
    expect(bbox![0]).toBeLessThan(bbox![2]);
    expect(bbox![1]).toBeLessThan(bbox![3]);
  });

  it('computes the axis-aligned bbox of a polygon', () => {
    const bbox = bboxFromGeometry({
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]],
    });
    expect(bbox).toEqual([0, 0, 10, 5]);
  });

  it('returns null for an empty geometry', () => {
    expect(bboxFromGeometry({ type: 'Polygon', coordinates: [] })).toBeNull();
  });

  it('computes bbox for a MultiPoint', () => {
    const bbox = bboxFromGeometry({
      type: 'MultiPoint',
      coordinates: [[0, 1], [5, 3], [2, 8]],
    });
    expect(bbox).toEqual([0, 1, 5, 8]);
  });

  it('computes bbox for a LineString', () => {
    const bbox = bboxFromGeometry({
      type: 'LineString',
      coordinates: [[-10, 0], [10, 5], [0, -3]],
    });
    expect(bbox).toEqual([-10, -3, 10, 5]);
  });

  it('computes bbox for a MultiLineString', () => {
    const bbox = bboxFromGeometry({
      type: 'MultiLineString',
      coordinates: [[[0, 0], [1, 1]], [[3, 4], [5, 2]]],
    });
    expect(bbox).toEqual([0, 0, 5, 4]);
  });

  it('computes bbox for a MultiPolygon', () => {
    const bbox = bboxFromGeometry({
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
        [[[5, 5], [8, 5], [8, 9], [5, 9], [5, 5]]],
      ],
    });
    expect(bbox).toEqual([0, 0, 8, 9]);
  });

  it('computes bbox for a GeometryCollection by combining member geometries', () => {
    const bbox = bboxFromGeometry({
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [-5, 2] },
        { type: 'Point', coordinates: [7, -1] },
      ],
    });
    // GeometryCollection bbox should span both points (no per-point padding)
    expect(bbox![0]).toBeLessThanOrEqual(-5);
    expect(bbox![2]).toBeGreaterThanOrEqual(7);
    expect(bbox![1]).toBeLessThanOrEqual(-1);
    expect(bbox![3]).toBeGreaterThanOrEqual(2);
  });

  it('returns null for an unknown geometry type', () => {
    expect(bboxFromGeometry({ type: 'Unknown', coordinates: [[0, 0]] })).toBeNull();
  });
});

describe('combineGeometries', () => {
  it('returns null for empty input', () => {
    expect(combineGeometries([])).toBeNull();
  });

  it('returns the single geometry unchanged when only one is given', () => {
    const g = { type: 'Point', coordinates: [0, 0] };
    expect(combineGeometries([g])).toBe(g);
  });

  it('wraps multiple geometries in a GeometryCollection', () => {
    const a = { type: 'Point', coordinates: [0, 0] };
    const b = { type: 'Point', coordinates: [1, 1] };
    expect(combineGeometries([a, b])).toEqual({
      type: 'GeometryCollection',
      geometries: [a, b],
    });
  });

  it('skips null/undefined entries', () => {
    const a = { type: 'Point', coordinates: [0, 0] };
    expect(combineGeometries([null, a, undefined])).toBe(a);
    expect(combineGeometries([null, undefined])).toBeNull();
  });
});

describe('applyZoomInstruction', () => {
  it('is a no-op for a null instruction', () => {
    let calls = 0;
    applyZoomInstruction(null, {
      flyTo: () => { calls++; },
      fitBounds: () => { calls++; },
    });
    expect(calls).toBe(0);
  });

  it('dispatches flyTo with center + zoom', () => {
    const seen: unknown[] = [];
    applyZoomInstruction(
      { type: 'flyTo', center: [1, 2], zoom: 14 },
      { flyTo: (center, zoom) => seen.push([center, zoom]), fitBounds: () => {} },
    );
    expect(seen).toEqual([[[1, 2], 14]]);
  });

  it('dispatches fitBounds with bbox + options', () => {
    const seen: unknown[] = [];
    applyZoomInstruction(
      { type: 'fitBounds', bbox: [0, 0, 1, 1], padding: 50, maxZoom: 18 },
      { flyTo: () => {}, fitBounds: (bbox, options) => seen.push([bbox, options]) },
    );
    expect(seen).toEqual([[[0, 0, 1, 1], { padding: 50, maxZoom: 18 }]]);
  });
});

describe('zoomToFeature', () => {
  it('returns null for missing geometry', () => {
    expect(zoomToFeature(null)).toBeNull();
    expect(zoomToFeature(undefined)).toBeNull();
  });

  it('returns a flyTo instruction for a Point with the default point zoom', () => {
    const result = zoomToFeature({ type: 'Point', coordinates: [-122.5, 37.5] });
    expect(result).toEqual({
      type: 'flyTo',
      center: [-122.5, 37.5],
      zoom: DEFAULT_POINT_ZOOM,
    });
  });

  it('honours pointZoom override', () => {
    const result = zoomToFeature(
      { type: 'Point', coordinates: [0, 0] },
      { pointZoom: 12 },
    );
    expect(result).toMatchObject({ type: 'flyTo', zoom: 12 });
  });

  it('clamps point zoom to layerMaxZoom', () => {
    const result = zoomToFeature(
      { type: 'Point', coordinates: [0, 0] },
      { pointZoom: 18, layerMaxZoom: 14 },
    );
    expect(result).toMatchObject({ type: 'flyTo', zoom: 14 });
  });

  it('clamps point zoom up to layerMinZoom', () => {
    const result = zoomToFeature(
      { type: 'Point', coordinates: [0, 0] },
      { pointZoom: 4, layerMinZoom: 8 },
    );
    expect(result).toMatchObject({ type: 'flyTo', zoom: 8 });
  });

  it('returns a fitBounds instruction for a Polygon', () => {
    const result = zoomToFeature({
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]],
    });
    expect(result).toEqual({
      type: 'fitBounds',
      bbox: [0, 0, 10, 5],
      padding: 50,
      maxZoom: DEFAULT_POLYGON_MAX_ZOOM,
    });
  });

  it('caps polygon maxZoom by layerMaxZoom', () => {
    const result = zoomToFeature(
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      { maxZoom: 20, layerMaxZoom: 14 },
    );
    expect(result).toMatchObject({ type: 'fitBounds', maxZoom: 14 });
  });

  it('uses flyTo for a degenerate polygon collapsed to a single point', () => {
    const result = zoomToFeature({
      type: 'Polygon',
      coordinates: [[[5, 5], [5, 5], [5, 5], [5, 5]]],
    });
    expect(result).toMatchObject({ type: 'flyTo', center: [5, 5] });
  });

  it('fits the combined extent of multiple geometries (fit-all matches)', () => {
    const combined = combineGeometries([
      { type: 'Point', coordinates: [0, 0] },
      { type: 'Point', coordinates: [10, 8] },
    ]);
    const result = zoomToFeature(combined);
    expect(result).toMatchObject({ type: 'fitBounds', bbox: [0, 0, 10, 8] });
  });
});

describe('featureCollectionFromGeometries', () => {
  it('returns null when given no usable geometries', () => {
    expect(featureCollectionFromGeometries([])).toBeNull();
    expect(featureCollectionFromGeometries([null, undefined])).toBeNull();
  });

  it('wraps each geometry in a Feature and skips null/undefined', () => {
    const a = { type: 'Point', coordinates: [0, 0] };
    const b = { type: 'Point', coordinates: [1, 1] };
    const fc = featureCollectionFromGeometries([a, null, b, undefined]);
    expect(fc).not.toBeNull();
    expect(fc!.type).toBe('FeatureCollection');
    expect(fc!.features).toHaveLength(2);
    expect(fc!.features[0]).toMatchObject({ type: 'Feature', geometry: a });
    expect(fc!.features[1]).toMatchObject({ type: 'Feature', geometry: b });
  });
});
