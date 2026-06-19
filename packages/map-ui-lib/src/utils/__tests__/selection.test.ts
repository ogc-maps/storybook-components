import { describe, expect, it } from 'vitest';
import { selectedFeatureKey } from '../selection';

describe('selectedFeatureKey', () => {
  it('uses layerId + feature id when id is present', () => {
    const key = selectedFeatureKey({ id: 42, layerId: 'parcels', properties: {}, geometry: {} });
    expect(key).toBe('parcels:42');
  });

  it('uses layerId + feature id for string ids', () => {
    const key = selectedFeatureKey({ id: 'abc', layerId: 'roads', properties: {}, geometry: {} });
    expect(key).toBe('roads:abc');
  });

  it('falls back to stable property serialization when id is undefined', () => {
    const key = selectedFeatureKey({
      id: undefined,
      layerId: 'layer1',
      properties: { name: 'Alice', age: 30 },
      geometry: {},
    });
    expect(key).toBe('layer1:{"age":30,"name":"Alice"}');
  });

  it('produces the same key regardless of property insertion order', () => {
    const featureA = {
      id: undefined,
      layerId: 'layer1',
      properties: { name: 'Alice', age: 30 },
      geometry: {},
    };
    const featureB = {
      id: undefined,
      layerId: 'layer1',
      properties: { age: 30, name: 'Alice' },
      geometry: {},
    };
    expect(selectedFeatureKey(featureA)).toBe(selectedFeatureKey(featureB));
  });

  it('treats id=null as absent (falls back to properties)', () => {
    const key = selectedFeatureKey({
      id: undefined,
      layerId: 'layer1',
      properties: { z: 1 },
      geometry: {},
    });
    expect(key).toContain('layer1:');
    expect(key).toContain('"z":1');
  });
});
