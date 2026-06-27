import { describe, it, expect } from 'vitest';
import {
  getLayerSourceKey,
  getSubLayerId,
  getLayerSubLayerIds,
  getVectorTileSourceKey,
} from '../ogcApi';
import type { CQL2Expression } from '../cql2';

const filter: CQL2Expression = {
  op: '=',
  args: [{ property: 'state' }, 'CO'],
} as unknown as CQL2Expression;

describe('sub-layer id helpers', () => {
  it('vector-tile source key omits the source-layer and folds in the filter', () => {
    const layer = { id: 'taxparcels', dataMode: 'vector-tiles', styles: [{ type: 'fill' }] };
    expect(getLayerSourceKey(layer)).toBe('taxparcels');
    expect(getLayerSourceKey(layer, filter)).toBe(getVectorTileSourceKey('taxparcels', filter));
  });

  it('geojson source key is just the layer id', () => {
    const layer = { id: 'opacity-test', dataMode: 'geojson', styles: [{ type: 'fill' }] };
    expect(getLayerSourceKey(layer)).toBe('opacity-test');
    expect(getLayerSourceKey(layer, filter)).toBe('opacity-test');
  });

  it('getLayerSubLayerIds enumerates one id per style in order', () => {
    const layer = {
      id: 'roads',
      dataMode: 'vector-tiles',
      styles: [{ type: 'line' }, { type: 'symbol' }],
    };
    expect(getLayerSubLayerIds(layer)).toEqual(['roads--line--0', 'roads--symbol--1']);
  });

  // The regression guard: the id a renderer emits (sourceKey built locally, then
  // getSubLayerId per style) MUST equal the id consumers look up via
  // getLayerSubLayerIds — for filtered + unfiltered vector tiles and geojson.
  describe('renderer id matches consumer id', () => {
    const layers = [
      { id: 'taxparcels', dataMode: 'vector-tiles', styles: [{ type: 'fill' }, { type: 'line' }] },
      { id: 'opacity-test', dataMode: 'geojson', styles: [{ type: 'fill' }, { type: 'line' }] },
    ];

    for (const layer of layers) {
      for (const f of [undefined, filter]) {
        it(`${layer.dataMode} ${f ? 'filtered' : 'unfiltered'}`, () => {
          // What a renderer emits for each style:
          const sourceKey = getLayerSourceKey(layer, f);
          const renderedIds = layer.styles.map((s, i) => getSubLayerId(sourceKey, s.type, i));
          // What a consumer (interactiveLayerIds etc.) builds:
          const consumerIds = getLayerSubLayerIds(layer, f);
          expect(renderedIds).toEqual(consumerIds);
        });
      }
    }
  });
});
