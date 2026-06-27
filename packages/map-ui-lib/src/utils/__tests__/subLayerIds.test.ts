import { describe, it, expect } from 'vitest';
import {
  getLayerSourceKey,
  getSubLayerId,
  getDashSubLayerId,
  getStyleSubLayerIds,
  getLayerSubLayerIds,
} from '../subLayerIds';
import { getVectorTileSourceKey } from '../ogcApi';
import { expandDashByCategory } from '../dashByCategory';
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

  // dashByCategory line styles render N per-case layers (+ default) with NO base
  // layer, so the consumer ids must expand the same way or roads tooltips break.
  describe('dashByCategory expansion', () => {
    const dashStyle = {
      type: 'line',
      dashByCategory: {
        property: 'category',
        cases: [
          { value: 'Secondary', dasharray: [2, 2] },
          { value: 'Vehicular Trail', dasharray: [1, 3] },
        ],
        default: [1, 0],
      },
    };

    it('getStyleSubLayerIds expands to one id per case + default, no base id', () => {
      const ids = getStyleSubLayerIds('roads', dashStyle, 0);
      expect(ids).toEqual([
        'roads--line--0--dash--Secondary',
        'roads--line--0--dash--Vehicular_Trail',
        'roads--line--0--dash--default',
      ]);
      expect(ids).not.toContain('roads--line--0');
    });

    it('a line style without dashByCategory stays a single base id', () => {
      expect(getStyleSubLayerIds('roads', { type: 'line' }, 0)).toEqual(['roads--line--0']);
    });

    it('getLayerSubLayerIds flattens dash + non-dash styles in order', () => {
      const layer = {
        id: 'roads',
        dataMode: 'vector-tiles',
        styles: [dashStyle, { type: 'symbol' }],
      };
      expect(getLayerSubLayerIds(layer)).toEqual([
        'roads--line--0--dash--Secondary',
        'roads--line--0--dash--Vehicular_Trail',
        'roads--line--0--dash--default',
        'roads--symbol--1',
      ]);
    });

    // The renderers emit dash ids as getDashSubLayerId(baseSubLayerId, idSuffix);
    // assert that exactly reproduces what getStyleSubLayerIds returns, so the two
    // can't drift (the regression that broke roads tooltips).
    it('renderer dash id construction matches getStyleSubLayerIds', () => {
      const baseSubLayerId = getSubLayerId('roads', dashStyle.type, 0);
      const rendererIds = expandDashByCategory(dashStyle as never).map((sub) =>
        getDashSubLayerId(baseSubLayerId, sub.idSuffix),
      );
      expect(rendererIds).toEqual(getStyleSubLayerIds('roads', dashStyle, 0));
    });
  });
});
