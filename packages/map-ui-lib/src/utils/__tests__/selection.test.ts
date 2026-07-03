import { describe, it, expect } from 'vitest';
import {
  selectedFeatureKey,
  mergeUniqueFeatures,
  buildHighlightFeatureCollection,
  MAX_SELECTION,
  type SelectedFeature,
} from '../selection';

const base = (overrides: Partial<SelectedFeature> = {}): SelectedFeature => ({
  id: undefined,
  layerId: 'layer-a',
  properties: {},
  geometry: {},
  ...overrides,
});

describe('selectedFeatureKey', () => {
  it('uses numeric id when present', () => {
    expect(selectedFeatureKey(base({ id: 42 }))).toBe('layer-a:42');
  });

  it('uses string id when present', () => {
    expect(selectedFeatureKey(base({ id: 'abc' }))).toBe('layer-a:abc');
  });

  it('falls back to JSON properties when id is undefined', () => {
    expect(selectedFeatureKey(base({ properties: { name: 'Park' } }))).toBe(
      'layer-a:{"name":"Park"}',
    );
  });

  it('falls back to JSON properties when id is null', () => {
    // SelectedFeature.id is typed as string|number|undefined, but callers
    // can pass null from untyped sources — ensure != null guard handles it.
    expect(
      selectedFeatureKey(base({ id: null as unknown as undefined, properties: { x: 1 } })),
    ).toBe('layer-a:{"x":1}');
  });

  it('includes layerId in every key', () => {
    const keyA = selectedFeatureKey({ ...base({ id: 1 }), layerId: 'roads' });
    const keyB = selectedFeatureKey({ ...base({ id: 1 }), layerId: 'parcels' });
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe('roads:1');
    expect(keyB).toBe('parcels:1');
  });

  it('two features with same layerId+id produce the same key regardless of properties', () => {
    const a = base({ id: 1, properties: { ignored: true } });
    const b = base({ id: 1, properties: { different: 'value' } });
    expect(selectedFeatureKey(a)).toBe(selectedFeatureKey(b));
  });

  it('two features with no id but different properties produce different keys', () => {
    const a = base({ properties: { name: 'A' } });
    const b = base({ properties: { name: 'B' } });
    expect(selectedFeatureKey(a)).not.toBe(selectedFeatureKey(b));
  });
});

function makeFeature(
  id: string | number | undefined,
  layerId = 'layer1',
  props: Record<string, unknown> = {},
): SelectedFeature {
  return { id, layerId, properties: { name: String(id), ...props }, geometry: { type: 'Point', coordinates: [0, 0] } };
}

// ---------------------------------------------------------------------------
// selectedFeatureKey
// ---------------------------------------------------------------------------

describe('selectedFeatureKey', () => {
  it('returns layerId:id for a string id', () => {
    expect(selectedFeatureKey(makeFeature('abc'))).toBe('layer1:abc');
  });

  it('returns layerId:id for a numeric id', () => {
    expect(selectedFeatureKey(makeFeature(42))).toBe('layer1:42');
  });

  it('returns layerId:id when id is 0 (falsy but defined)', () => {
    expect(selectedFeatureKey(makeFeature(0))).toBe('layer1:0');
  });

  it('falls back to JSON.stringify(properties) when id is undefined', () => {
    const f: SelectedFeature = {
      id: undefined,
      layerId: 'myLayer',
      properties: { x: 1, y: 'hello' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    };
    expect(selectedFeatureKey(f)).toBe('myLayer:{"x":1,"y":"hello"}');
  });

  it('different layerIds produce different keys even with the same feature id', () => {
    const a = makeFeature('id', 'layerA');
    const b = makeFeature('id', 'layerB');
    expect(selectedFeatureKey(a)).not.toBe(selectedFeatureKey(b));
  });
});

// ---------------------------------------------------------------------------
// mergeUniqueFeatures
// ---------------------------------------------------------------------------

describe('mergeUniqueFeatures', () => {
  it('appends non-duplicate features', () => {
    const a = makeFeature('a');
    const b = makeFeature('b');
    const result = mergeUniqueFeatures([a], [b]);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe(b);
  });

  it('skips incoming features whose key already exists', () => {
    const a = makeFeature('a');
    const result = mergeUniqueFeatures([a], [a]);
    expect(result).toHaveLength(1);
  });

  it('skips partial duplicates when only some incoming are new', () => {
    const a = makeFeature('a');
    const b = makeFeature('b');
    const result = mergeUniqueFeatures([a], [a, b]);
    expect(result).toHaveLength(2);
  });

  it('preserves existing order and appends unique incoming in order', () => {
    const a = makeFeature('a');
    const b = makeFeature('b');
    const c = makeFeature('c');
    const result = mergeUniqueFeatures([a, b], [c, a]);
    expect(result.map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('caps at MAX_SELECTION by default', () => {
    const existing = Array.from({ length: MAX_SELECTION - 1 }, (_, i) => makeFeature(i));
    const incoming = [makeFeature('x'), makeFeature('y')];
    const result = mergeUniqueFeatures(existing, incoming);
    expect(result).toHaveLength(MAX_SELECTION);
    expect(result[MAX_SELECTION - 1].id).toBe('x');
  });

  it('does not exceed MAX_SELECTION even with many new features', () => {
    const existing = Array.from({ length: MAX_SELECTION }, (_, i) => makeFeature(i));
    const incoming = Array.from({ length: 100 }, (_, i) => makeFeature(`extra_${i}`));
    expect(mergeUniqueFeatures(existing, incoming)).toHaveLength(MAX_SELECTION);
  });

  it('respects a custom max', () => {
    const a = makeFeature('a');
    const b = makeFeature('b');
    const c = makeFeature('c');
    const result = mergeUniqueFeatures([a, b], [c], 2);
    expect(result).toHaveLength(2);
  });

  it('does not mutate the existing array', () => {
    const existing = [makeFeature('a')];
    const copy = [...existing];
    mergeUniqueFeatures(existing, [makeFeature('b')]);
    expect(existing).toEqual(copy);
  });

  it('handles an empty existing array', () => {
    const b = makeFeature('b');
    expect(mergeUniqueFeatures([], [b])).toEqual([b]);
  });

  it('handles an empty incoming array', () => {
    const a = makeFeature('a');
    expect(mergeUniqueFeatures([a], [])).toEqual([a]);
  });

  it('deduplicates by property-key fallback when id is undefined', () => {
    const f1: SelectedFeature = { id: undefined, layerId: 'l', properties: { v: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } };
    const f2: SelectedFeature = { id: undefined, layerId: 'l', properties: { v: 1 }, geometry: { type: 'Point', coordinates: [1, 1] } };
    expect(mergeUniqueFeatures([f1], [f2])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildHighlightFeatureCollection
// ---------------------------------------------------------------------------

describe('buildHighlightFeatureCollection', () => {
  it('returns null for an empty array', () => {
    expect(buildHighlightFeatureCollection([])).toBeNull();
  });

  it('returns a FeatureCollection for a non-empty array', () => {
    const fc = buildHighlightFeatureCollection([makeFeature('a')]);
    expect(fc?.type).toBe('FeatureCollection');
  });

  it('includes one GeoJSON Feature per selected feature', () => {
    const fc = buildHighlightFeatureCollection([makeFeature('a'), makeFeature('b')]);
    expect(fc?.features).toHaveLength(2);
  });

  it('preserves properties on each feature', () => {
    const f = makeFeature('a', 'layer1', { score: 42 });
    const fc = buildHighlightFeatureCollection([f]);
    expect(fc?.features[0].properties).toMatchObject({ name: 'a', score: 42 });
  });

  it('sets type: Feature on each entry', () => {
    const fc = buildHighlightFeatureCollection([makeFeature('a')]);
    expect(fc?.features[0].type).toBe('Feature');
  });
});
