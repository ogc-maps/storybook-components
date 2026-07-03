import { describe, it, expect } from 'vitest';
import { selectedFeatureKey } from '../selection';
import type { SelectedFeature } from '../selection';

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
