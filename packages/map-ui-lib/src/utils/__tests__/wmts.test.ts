// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  buildWmtsTileUrlTemplate,
  parseWmtsCapabilities,
  fetchWmtsCapabilities,
  resolveWmtsTileUrlTemplate,
  isOgcApiSource,
  isWmtsSource,
  isImagerySource,
  type WmtsLayer,
} from '../wmts';
import type { MapSource } from '../../types';

const wmtsSource: MapSource = {
  id: 'usgs-topo',
  sourceType: 'wmts',
  capabilitiesUrl: 'https://example.com/wmts/GetCapabilities.xml',
  layer: 'usgs-topo',
  style: 'default',
  format: 'image/png',
  tileMatrixSet: 'WebMercatorQuad',
  tileSize: 256,
};
const imageryOgcSource: MapSource = {
  id: 'goes',
  url: 'https://example.com/ogc',
  type: 'imagery',
};
const featuresOgcSource: MapSource = {
  id: 'parcels',
  url: 'https://example.com/ogc',
  type: 'features',
};

describe('source-role guards', () => {
  it('isWmtsSource narrows only WMTS sources', () => {
    expect(isWmtsSource(wmtsSource)).toBe(true);
    expect(isWmtsSource(imageryOgcSource)).toBe(false);
    expect(isWmtsSource(featuresOgcSource)).toBe(false);
  });

  it('isOgcApiSource is the inverse of isWmtsSource', () => {
    expect(isOgcApiSource(wmtsSource)).toBe(false);
    expect(isOgcApiSource(imageryOgcSource)).toBe(true);
    expect(isOgcApiSource(featuresOgcSource)).toBe(true);
  });

  it('isImagerySource accepts WMTS and OGC imagery, rejects OGC features', () => {
    expect(isImagerySource(wmtsSource)).toBe(true);
    expect(isImagerySource(imageryOgcSource)).toBe(true);
    expect(isImagerySource(featuresOgcSource)).toBe(false);
  });
});

describe('buildWmtsTileUrlTemplate', () => {
  it('builds a {z}/{y}/{x} template from a capabilities URL', () => {
    const url = buildWmtsTileUrlTemplate(
      'https://example.com/wmts/GetCapabilities.xml',
      'MyLayer',
      'default',
      'WebMercatorQuad',
      'image/png',
    );
    expect(url).toBe('https://example.com/wmts/MyLayer/default/WebMercatorQuad/{z}/{y}/{x}.png');
  });

  it('strips a trailing slash and query string from the capabilities URL', () => {
    const url = buildWmtsTileUrlTemplate(
      'https://example.com/wmts/?service=WMTS&request=GetCapabilities',
      'L',
      'default',
      'WebMercatorQuad',
      'image/jpeg',
    );
    expect(url).toBe('https://example.com/wmts/L/default/WebMercatorQuad/{z}/{y}/{x}.jpg');
  });

  it('maps image/jpeg to the jpg extension', () => {
    const url = buildWmtsTileUrlTemplate(
      'https://example.com/wmts/GetCapabilities.xml',
      'L',
      'default',
      'WebMercatorQuad',
      'image/jpeg',
    );
    expect(url.endsWith('.jpg')).toBe(true);
  });

  it('appends query-param auth', () => {
    const url = buildWmtsTileUrlTemplate(
      'https://example.com/wmts/GetCapabilities.xml',
      'L',
      'default',
      'WebMercatorQuad',
      'image/png',
      { type: 'query_param', name: 'key', value: 'secret' },
    );
    expect(url).toMatch(/\?key=secret$/);
  });
});

describe('parseWmtsCapabilities', () => {
  const minimalCapabilities = `<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0">
  <Contents>
    <Layer>
      <Identifier>L1</Identifier>
      <Title>Layer One</Title>
      <Style>
        <Identifier>default</Identifier>
      </Style>
      <Format>image/png</Format>
      <Format>image/jpeg</Format>
      <TileMatrixSetLink>
        <TileMatrixSet>WebMercatorQuad</TileMatrixSet>
      </TileMatrixSetLink>
    </Layer>
  </Contents>
</Capabilities>`;

  it('extracts layers with styles, formats, and tile matrix sets', () => {
    const caps = parseWmtsCapabilities(minimalCapabilities);
    expect(caps.layers).toHaveLength(1);
    const layer = caps.layers[0];
    expect(layer.id).toBe('L1');
    expect(layer.title).toBe('Layer One');
    expect(layer.styles).toEqual(['default']);
    expect(layer.formats).toEqual(['image/png', 'image/jpeg']);
    expect(layer.tileMatrixSets).toEqual(['WebMercatorQuad']);
  });

  it('throws a clear error on invalid XML', () => {
    expect(() => parseWmtsCapabilities('not xml at all <<<')).toThrow(/not valid XML/);
  });
});

describe('fetchWmtsCapabilities', () => {
  const minimalXml = `<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0">
  <Contents>
    <Layer>
      <Identifier>L1</Identifier>
      <Style><Identifier>default</Identifier></Style>
      <Format>image/png</Format>
      <TileMatrixSetLink><TileMatrixSet>WebMercatorQuad</TileMatrixSet></TileMatrixSetLink>
    </Layer>
  </Contents>
</Capabilities>`;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and parses a capabilities document', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(minimalXml, { status: 200 }),
    );
    const caps = await fetchWmtsCapabilities('https://example.com/wmts/GetCapabilities.xml');
    expect(caps.layers).toHaveLength(1);
    expect(caps.layers[0].id).toBe('L1');
  });

  it('throws on non-ok response with status code in message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    await expect(
      fetchWmtsCapabilities('https://example.com/wmts/GetCapabilities.xml'),
    ).rejects.toThrow(/404.*Not Found/);
  });

  it('sends header auth via Headers', async () => {
    const mock = fetch as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue(new Response(minimalXml, { status: 200 }));
    await fetchWmtsCapabilities('https://example.com/wmts/GetCapabilities.xml', {
      type: 'header',
      name: 'Authorization',
      value: 'Bearer xyz',
    });
    const [, init] = mock.mock.calls[0];
    expect(init.headers).toEqual({ Authorization: 'Bearer xyz' });
  });

  it('appends query-param auth to the fetched URL', async () => {
    const mock = fetch as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue(new Response(minimalXml, { status: 200 }));
    await fetchWmtsCapabilities('https://example.com/wmts/GetCapabilities.xml', {
      type: 'query_param',
      name: 'apikey',
      value: 'secret',
    });
    const [fetchedUrl] = mock.mock.calls[0];
    expect(fetchedUrl).toContain('apikey=secret');
  });

  it('forwards an AbortSignal to fetch so an aborted controller cancels the request', async () => {
    const controller = new AbortController();
    const mock = fetch as ReturnType<typeof vi.fn>;
    mock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const pending = fetchWmtsCapabilities(
      'https://example.com/wmts/GetCapabilities.xml',
      undefined,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/i);
    const [, init] = mock.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });
});

describe('buildWmtsTileUrlTemplate (hardened stripping)', () => {
  it('strips a /GetCapabilities path with no .xml extension', () => {
    const url = buildWmtsTileUrlTemplate(
      'https://api.gic.org/wmts/GetCapabilities',
      'bluesky-ultra-g',
      'RGB',
      'bluesky-ultra-g',
      'image/png',
    );
    expect(url).toBe(
      'https://api.gic.org/wmts/bluesky-ultra-g/RGB/bluesky-ultra-g/{z}/{y}/{x}.png',
    );
  });

  it('drops a trailing version segment like /1.0.0 left by the capabilities path', () => {
    const url = buildWmtsTileUrlTemplate(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml',
      'L',
      'default',
      'GoogleMapsCompatible_Level9',
      'image/jpeg',
    );
    expect(url).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/L/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
    );
  });
});

describe('parseWmtsCapabilities — dimensions & tile ResourceURLs', () => {
  const gibsLike = `<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1">
  <Contents>
    <Layer>
      <ows:Identifier>MODIS</ows:Identifier>
      <Style><ows:Identifier>default</ows:Identifier></Style>
      <Dimension>
        <ows:Identifier>Time</ows:Identifier>
        <Default>2026-06-23</Default>
      </Dimension>
      <TileMatrixSetLink><TileMatrixSet>GoogleMapsCompatible_Level9</TileMatrixSet></TileMatrixSetLink>
      <Format>image/jpeg</Format>
      <ResourceURL resourceType="tile" format="image/jpeg" template="https://gibs/best/MODIS/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpeg"/>
      <ResourceURL resourceType="tile" format="image/png" template="https://gibs/best/MODIS/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"/>
    </Layer>
  </Contents>
</Capabilities>`;

  it('captures dimensions with their default and all tile ResourceURLs by format', () => {
    const layer = parseWmtsCapabilities(gibsLike).layers[0];
    expect(layer.dimensions).toEqual([{ id: 'Time', default: '2026-06-23' }]);
    expect(layer.tileResourceUrls).toHaveLength(2);
    expect(layer.tileResourceUrls?.map((r) => r.format)).toEqual(['image/jpeg', 'image/png']);
    expect(layer.tileResourceUrls?.[0].template).toContain('{Time}');
  });
});

describe('resolveWmtsTileUrlTemplate', () => {
  const gibsLayer: WmtsLayer = {
    id: 'MODIS',
    styles: ['default'],
    tileMatrixSets: ['GoogleMapsCompatible_Level9'],
    formats: ['image/jpeg'],
    dimensions: [{ id: 'Time', default: '2026-06-23' }],
    tileResourceUrls: [
      { format: 'image/jpeg', template: 'https://gibs/best/MODIS/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpeg' },
      { format: 'image/png', template: 'https://gibs/best/MODIS/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png' },
    ],
  };

  it('fills the Time dimension with its default and maps tile tokens to {z}/{y}/{x}', () => {
    expect(
      resolveWmtsTileUrlTemplate(gibsLayer, {
        style: 'default',
        tileMatrixSet: 'GoogleMapsCompatible_Level9',
        format: 'image/jpeg',
      }),
    ).toBe('https://gibs/best/MODIS/default/2026-06-23/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg');
  });

  it('picks the ResourceURL matching the requested format', () => {
    const url = resolveWmtsTileUrlTemplate(gibsLayer, {
      style: 'default',
      tileMatrixSet: 'GoogleMapsCompatible_Level9',
      format: 'image/png',
    });
    expect(url?.endsWith('.png')).toBe(true);
  });

  it('resolves a dimension-less layer (Vexcel-shaped) cleanly', () => {
    const vexcelLayer: WmtsLayer = {
      id: 'bluesky-ultra-g',
      styles: ['RGB'],
      tileMatrixSets: ['bluesky-ultra-g'],
      formats: ['image/png'],
      tileResourceUrls: [
        { format: 'image/png', template: 'https://api.gic.org/wmts/rest/{Layer}/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png' },
      ],
    };
    expect(
      resolveWmtsTileUrlTemplate(vexcelLayer, { style: 'RGB', tileMatrixSet: 'bluesky-ultra-g' }),
    ).toBe('https://api.gic.org/wmts/rest/bluesky-ultra-g/RGB/bluesky-ultra-g/{z}/{y}/{x}.png');
  });

  it('returns null when the layer advertises no tile ResourceURL', () => {
    expect(
      resolveWmtsTileUrlTemplate(
        { id: 'L', styles: [], tileMatrixSets: [], formats: [] },
        { style: 'default', tileMatrixSet: 'WebMercatorQuad' },
      ),
    ).toBeNull();
  });

  it('returns null (falls back) when an unmodeled placeholder remains', () => {
    const layer: WmtsLayer = {
      id: 'L',
      styles: ['default'],
      tileMatrixSets: ['WebMercatorQuad'],
      formats: ['image/png'],
      // {Elevation} is not in dimensions → unresolvable.
      tileResourceUrls: [
        { format: 'image/png', template: 'https://h/L/{Style}/{Elevation}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png' },
      ],
    };
    expect(
      resolveWmtsTileUrlTemplate(layer, { style: 'default', tileMatrixSet: 'WebMercatorQuad' }),
    ).toBeNull();
  });
});
