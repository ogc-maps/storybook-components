import { describe, it, expect } from 'vitest';
import {
  LayerConfigSchema,
  FilterRuleSchema,
  FilterRuleGroupSchema,
  FilterRuleValueSchema,
  Cql2FilterConfigSchema,
  InfoConfigSchema,
  MapConfigSchema,
  ViewConfigSchema,
  WmtsSourceSchema,
} from '../config';

const baseMapConfig = {
  sources: [{ id: 'src-1', url: 'https://example.com/ogc' }],
  layers: [
    {
      id: 'layer-1',
      sourceId: 'src-1',
      collection: 'my-collection',
      label: 'Test Layer',
      dataMode: 'vector-tiles' as const,
    },
  ],
  basemaps: [{ id: 'osm', label: 'OSM', url: 'https://example.com/style.json' }],
  initialView: { latitude: 0, longitude: 0, zoom: 2 },
};

describe('LayerConfigSchema backward-compat preprocess', () => {
  const base = {
    id: 'test-layer',
    sourceId: 'source-1',
    collection: 'my-collection',
    label: 'Test Layer',
    dataMode: 'vector-tiles' as const,
  };

  it('migrates style → styles on parse', () => {
    const input = {
      ...base,
      style: {
        type: 'fill',
        paint: { 'fill-color': '#ff0000', 'fill-opacity': 0.5 },
      },
    };
    const result = LayerConfigSchema.parse(input);
    expect((result as any).style).toBeUndefined();
    expect(result.styles).toHaveLength(1);
    expect(result.styles![0].type).toBe('fill');
  });

  it('passes through already-migrated styles untouched', () => {
    const input = {
      ...base,
      styles: [
        { type: 'fill', paint: { 'fill-color': '#0000ff', 'fill-opacity': 1 } },
        { type: 'circle', paint: { 'circle-color': '#ff0000', 'circle-radius': 5, 'circle-opacity': 1 } },
      ],
    };
    const result = LayerConfigSchema.parse(input);
    expect(result.styles).toHaveLength(2);
  });

  it('handles style: undefined → styles: undefined', () => {
    const input = { ...base, style: undefined };
    const result = LayerConfigSchema.parse(input);
    expect(result.styles).toBeUndefined();
  });

  it('parses geometryFilter on style entries', () => {
    const input = {
      ...base,
      styles: [
        {
          type: 'fill',
          paint: { 'fill-color': '#0000ff', 'fill-opacity': 1 },
          geometryFilter: ['Polygon', 'MultiPolygon'],
        },
      ],
    };
    const result = LayerConfigSchema.parse(input);
    expect(result.styles![0].geometryFilter).toEqual(['Polygon', 'MultiPolygon']);
  });
});

describe('CQL2 Filter Schemas', () => {
  describe('FilterRuleValueSchema', () => {
    it('accepts static', () => {
      const input = { kind: 'static', value: 'hello' };
      const result = FilterRuleValueSchema.parse(input);
      expect(result.kind).toBe('static');
    });

    it('accepts parameter', () => {
      const input = { kind: 'parameter', name: 'foo', label: 'Foo', inputType: 'text' };
      const result = FilterRuleValueSchema.parse(input);
      expect(result.kind).toBe('parameter');
    });

    it('accepts relativeDate', () => {
      const input = {
        kind: 'relativeDate',
        direction: 'past',
        offset: { kind: 'static', value: 5 },
        unit: 'days',
      };
      const result = FilterRuleValueSchema.parse(input);
      expect(result.kind).toBe('relativeDate');
    });

    it('accepts dateRange', () => {
      const input = {
        kind: 'dateRange',
        start: {
          kind: 'relativeDate',
          direction: 'past',
          offset: { kind: 'static', value: 30 },
          unit: 'days',
        },
        end: { kind: 'static', value: '2026-01-01' },
      };
      const result = FilterRuleValueSchema.parse(input);
      expect(result.kind).toBe('dateRange');
    });

    it('accepts computedRange', () => {
      const input = {
        kind: 'computedRange',
        baseParam: 'price',
        baseLabel: 'Price',
        offsetType: 'percentage',
        offsetAmount: { kind: 'static', value: 20 },
      };
      const result = FilterRuleValueSchema.parse(input);
      expect(result.kind).toBe('computedRange');
    });

    it('rejects unknown kind', () => {
      const input = { kind: 'unknown' };
      expect(() => FilterRuleValueSchema.parse(input)).toThrow();
    });
  });

  describe('FilterRuleSchema', () => {
    it('accepts valid rule', () => {
      const input = {
        id: 'r1',
        property: 'name',
        operator: '=',
        value: { kind: 'static', value: 'test' },
      };
      const result = FilterRuleSchema.parse(input);
      expect(result.id).toBe('r1');
      expect(result.property).toBe('name');
    });

    it('rejects missing property', () => {
      const input = {
        id: 'r1',
        operator: '=',
        value: { kind: 'static', value: 'test' },
      };
      expect(() => FilterRuleSchema.parse(input)).toThrow();
    });
  });

  describe('FilterRuleGroupSchema', () => {
    it('accepts nested groups', () => {
      const input = {
        id: 'g1',
        combinator: 'and',
        rules: [
          {
            id: 'r1',
            property: 'name',
            operator: '=',
            value: { kind: 'static', value: 'test' },
          },
          {
            id: 'g2',
            combinator: 'or',
            rules: [
              {
                id: 'r2',
                property: 'age',
                operator: '>',
                value: { kind: 'static', value: 18 },
              },
            ],
          },
        ],
      };
      const result = FilterRuleGroupSchema.parse(input);
      expect(result.combinator).toBe('and');
      expect(result.rules).toHaveLength(2);
    });

    it('accepts sortby and limit', () => {
      const input = {
        id: 'g1',
        combinator: 'and',
        rules: [
          {
            id: 'r1',
            property: 'name',
            operator: '=',
            value: { kind: 'static', value: 'test' },
          },
        ],
        sortby: [
          { property: 'name', direction: 'asc' },
          { property: 'date', direction: 'desc' },
        ],
        limit: 50,
      };
      const result = FilterRuleGroupSchema.parse(input);
      expect(result.sortby).toHaveLength(2);
      expect(result.limit).toBe(50);
    });
  });

  describe('LayerConfigSchema with cql2Filter', () => {
    it('accepts cql2Filter', () => {
      const input = {
        id: 'layer-1',
        sourceId: 'source-1',
        collection: 'my-collection',
        label: 'Test Layer',
        dataMode: 'vector-tiles',
        cql2Filter: {
          id: 'g1',
          combinator: 'and',
          rules: [
            {
              id: 'r1',
              property: 'status',
              operator: '=',
              value: { kind: 'static', value: 'active' },
            },
          ],
        },
      };
      const result = LayerConfigSchema.parse(input);
      expect(result.cql2Filter).toBeDefined();
      expect(result.cql2Filter!.id).toBe('g1');
    });
  });
});

describe('ViewConfigSchema', () => {
  const base = { latitude: 0, longitude: 0, zoom: 10, pitch: 0, bearing: 0 };

  it('parses without minZoom/maxZoom (backward compat)', () => {
    const result = ViewConfigSchema.parse(base);
    expect(result.minZoom).toBeUndefined();
    expect(result.maxZoom).toBeUndefined();
  });

  it('parses with valid minZoom only', () => {
    const result = ViewConfigSchema.parse({ ...base, minZoom: 2 });
    expect(result.minZoom).toBe(2);
    expect(result.maxZoom).toBeUndefined();
  });

  it('parses with valid maxZoom only', () => {
    const result = ViewConfigSchema.parse({ ...base, maxZoom: 18 });
    expect(result.maxZoom).toBe(18);
    expect(result.minZoom).toBeUndefined();
  });

  it('parses with valid minZoom and maxZoom', () => {
    const result = ViewConfigSchema.parse({ ...base, minZoom: 2, maxZoom: 18 });
    expect(result.minZoom).toBe(2);
    expect(result.maxZoom).toBe(18);
  });

  it('rejects minZoom > maxZoom', () => {
    expect(() => ViewConfigSchema.parse({ ...base, minZoom: 18, maxZoom: 2 })).toThrow();
  });

  it('rejects zoom below minZoom', () => {
    expect(() => ViewConfigSchema.parse({ ...base, zoom: 1, minZoom: 5 })).toThrow();
  });

  it('rejects zoom above maxZoom', () => {
    expect(() => ViewConfigSchema.parse({ ...base, zoom: 20, maxZoom: 15 })).toThrow();
  });

  it('rejects minZoom out of range', () => {
    expect(() => ViewConfigSchema.parse({ ...base, minZoom: -1 })).toThrow();
    expect(() => ViewConfigSchema.parse({ ...base, minZoom: 25 })).toThrow();
  });

  it('rejects maxZoom out of range', () => {
    expect(() => ViewConfigSchema.parse({ ...base, maxZoom: -1 })).toThrow();
    expect(() => ViewConfigSchema.parse({ ...base, maxZoom: 25 })).toThrow();
  });
});

describe('UIConfigSchema phase-2 additions', () => {
  it('defaults showScaleBar to false and coordinateFormat to decimal-degrees', () => {
    const result = MapConfigSchema.parse(baseMapConfig);
    expect(result.ui.showScaleBar).toBe(false);
    expect(result.ui.coordinateFormat).toBe('decimal-degrees');
    expect(result.ui.legendOrder).toBeUndefined();
  });

  it('accepts legendOrder as an array of layer IDs', () => {
    const result = MapConfigSchema.parse({
      ...baseMapConfig,
      ui: { legendOrder: ['layer-1', 'layer-2'] },
    });
    expect(result.ui.legendOrder).toEqual(['layer-1', 'layer-2']);
  });

  it('accepts ddm and dms as coordinateFormat values', () => {
    const ddm = MapConfigSchema.parse({
      ...baseMapConfig,
      ui: { coordinateFormat: 'ddm' },
    });
    expect(ddm.ui.coordinateFormat).toBe('ddm');
    const dms = MapConfigSchema.parse({
      ...baseMapConfig,
      ui: { coordinateFormat: 'dms' },
    });
    expect(dms.ui.coordinateFormat).toBe('dms');
  });

  it('rejects an invalid coordinateFormat value', () => {
    expect(() =>
      MapConfigSchema.parse({
        ...baseMapConfig,
        ui: { coordinateFormat: 'utm' },
      }),
    ).toThrow();
  });
});

describe('UIConfigSchema controlIcons / controlPositions partial records', () => {
  it('accepts a controlIcons override for a single control', () => {
    const result = MapConfigSchema.parse({
      ...baseMapConfig,
      ui: { controlIcons: { showSearchPanel: 'filter' } },
    });
    expect(result.ui.controlIcons).toEqual({ showSearchPanel: 'filter' });
  });

  it('accepts multiple controlIcons keys', () => {
    const result = MapConfigSchema.parse({
      ...baseMapConfig,
      ui: { controlIcons: { showSearchPanel: 'filter', showLegend: 'list' } },
    });
    expect(result.ui.controlIcons).toEqual({ showSearchPanel: 'filter', showLegend: 'list' });
  });

  it('accepts an empty controlIcons object', () => {
    const result = MapConfigSchema.parse({
      ...baseMapConfig,
      ui: { controlIcons: {} },
    });
    expect(result.ui.controlIcons).toEqual({});
  });

  it('leaves controlIcons undefined when omitted', () => {
    const result = MapConfigSchema.parse(baseMapConfig);
    expect(result.ui.controlIcons).toBeUndefined();
  });

  it('rejects a non-string controlIcons value', () => {
    expect(() =>
      MapConfigSchema.parse({
        ...baseMapConfig,
        ui: { controlIcons: { showSearchPanel: 123 } },
      }),
    ).toThrow();
  });

  it('rejects a controlIcons key that is not an orderable control', () => {
    expect(() =>
      MapConfigSchema.parse({
        ...baseMapConfig,
        ui: { controlIcons: { notAControl: 'filter' } },
      }),
    ).toThrow();
  });

  it('accepts a controlPositions override for a single control', () => {
    const result = MapConfigSchema.parse({
      ...baseMapConfig,
      ui: { controlPositions: { showSearchPanel: 'bottom-left' } },
    });
    expect(result.ui.controlPositions).toEqual({ showSearchPanel: 'bottom-left' });
  });

  it('accepts an empty controlPositions object', () => {
    const result = MapConfigSchema.parse({
      ...baseMapConfig,
      ui: { controlPositions: {} },
    });
    expect(result.ui.controlPositions).toEqual({});
  });

  it('rejects an invalid controlPositions corner value', () => {
    expect(() =>
      MapConfigSchema.parse({
        ...baseMapConfig,
        ui: { controlPositions: { showSearchPanel: 'not-a-corner' } },
      }),
    ).toThrow();
  });
});

describe('InfoConfigSchema', () => {
  it('parses a MapConfig without an info field (back-compat)', () => {
    const result = MapConfigSchema.parse(baseMapConfig);
    expect(result.info).toBeUndefined();
  });

  it('populates defaults from empty input', () => {
    const result = InfoConfigSchema.parse({});
    expect(result).toEqual({
      enabled: false,
      markdown: '',
      position: 'top-right',
    });
  });

  it('rejects an invalid position', () => {
    expect(() => InfoConfigSchema.parse({ position: 'invalid' })).toThrow();
  });

  it('round-trips a fully populated info object', () => {
    const input = {
      enabled: true,
      title: 'About this map',
      markdown: '# Hello\n\nThis is a map.',
      position: 'bottom-left' as const,
    };
    const result = InfoConfigSchema.parse(input);
    expect(result).toEqual(input);
  });
});

describe('WmtsSourceSchema', () => {
  const validWmts = {
    id: 'nasa-gibs',
    sourceType: 'wmts' as const,
    capabilitiesUrl: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GetCapabilities.xml',
    layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
  };

  it('parses a valid WMTS source with defaults', () => {
    const result = WmtsSourceSchema.parse(validWmts);
    expect(result.id).toBe('nasa-gibs');
    expect(result.sourceType).toBe('wmts');
    expect(result.layer).toBe('MODIS_Terra_CorrectedReflectance_TrueColor');
    expect(result.tileSize).toBe(256);
  });

  it('applies default values for style, format, tileMatrixSet', () => {
    const minimal = {
      id: 'test',
      sourceType: 'wmts' as const,
      capabilitiesUrl: 'https://example.com/wmts/GetCapabilities.xml',
      layer: 'my-layer',
    };
    const result = WmtsSourceSchema.parse(minimal);
    expect(result.style).toBe('default');
    expect(result.format).toBe('image/png');
    expect(result.tileMatrixSet).toBe('WebMercatorQuad');
    expect(result.tileSize).toBe(256);
  });

  it('rejects WMTS source missing required layer', () => {
    const invalid = { id: 'test', sourceType: 'wmts', capabilitiesUrl: 'https://example.com/wmts/GetCapabilities.xml' };
    expect(() => WmtsSourceSchema.parse(invalid)).toThrow();
  });

  it('rejects WMTS source with invalid capabilitiesUrl', () => {
    const invalid = { ...validWmts, capabilitiesUrl: 'not-a-url' };
    expect(() => WmtsSourceSchema.parse(invalid)).toThrow();
  });
});

describe('MapConfigSchema with WMTS sources', () => {
  const baseConfig = {
    layers: [],
    basemaps: [{ id: 'osm', label: 'OSM', url: 'https://example.com/style.json' }],
    initialView: { latitude: 0, longitude: 0, zoom: 2 },
  };

  it('accepts a MapConfig with an OGC API source (backward compat)', () => {
    const config = {
      ...baseConfig,
      sources: [{ id: 'src-1', url: 'https://example.com/ogc' }],
    };
    const result = MapConfigSchema.parse(config);
    expect(result.sources).toHaveLength(1);
  });

  it('accepts a MapConfig with a WMTS source', () => {
    const config = {
      ...baseConfig,
      sources: [
        {
          id: 'gibs',
          sourceType: 'wmts',
          capabilitiesUrl: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GetCapabilities.xml',
          layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
        },
      ],
    };
    const result = MapConfigSchema.parse(config);
    expect(result.sources).toHaveLength(1);
    const src = result.sources[0] as { sourceType: string; layer: string };
    expect(src.sourceType).toBe('wmts');
    expect(src.layer).toBe('MODIS_Terra_CorrectedReflectance_TrueColor');
  });

  it('accepts a MapConfig with mixed OGC API and WMTS sources', () => {
    const config = {
      ...baseConfig,
      sources: [
        { id: 'ogc-src', url: 'https://example.com/ogc' },
        {
          id: 'gibs',
          sourceType: 'wmts',
          capabilitiesUrl: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GetCapabilities.xml',
          layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
        },
      ],
    };
    const result = MapConfigSchema.parse(config);
    expect(result.sources).toHaveLength(2);
  });
});
