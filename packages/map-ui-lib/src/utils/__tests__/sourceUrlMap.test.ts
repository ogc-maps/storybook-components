import { describe, it, expect } from 'vitest';
import type { MapSource } from '../../types';
import {
  buildSourceUrlMap,
  buildHeaderAuthTransformRequest,
  createLatestTransformRequest,
  type TransformRequestFn,
} from '../sourceUrlMap';

const ogc: MapSource = {
  id: 'ogc-1',
  url: 'https://example.com/ogc',
  tileMatrixSetId: 'WebMercatorQuad',
  type: 'features',
};

const wmts: MapSource = {
  id: 'wmts-1',
  sourceType: 'wmts',
  capabilitiesUrl: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml',
  layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
  style: 'default',
  format: 'image/jpeg',
  tileMatrixSet: 'GoogleMapsCompatible_Level9',
  tileSize: 256,
};

describe('buildSourceUrlMap', () => {
  it('maps OGC API sources to url + tileMatrixSetId + auth', () => {
    const map = buildSourceUrlMap([ogc]);
    expect(map['ogc-1']).toEqual({
      url: 'https://example.com/ogc',
      tileMatrixSetId: 'WebMercatorQuad',
      auth: undefined,
    });
    expect(map['ogc-1'].isWmts).toBeUndefined();
  });

  it('maps WMTS sources to a precomputed tile URL template', () => {
    const map = buildSourceUrlMap([wmts]);
    expect(map['wmts-1'].isWmts).toBe(true);
    expect(map['wmts-1'].url).toBe('');
    expect(map['wmts-1'].tileUrlTemplate).toMatch(/\{z\}\/\{y\}\/\{x\}\.jpg$/);
    expect(map['wmts-1'].tileUrlTemplate).toContain('MODIS_Terra_CorrectedReflectance_TrueColor');
  });

  it('honors a pre-supplied tileUrlTemplate override on a WMTS source', () => {
    const overridden: MapSource = { ...(wmts as object), tileUrlTemplate: 'https://override/{z}/{y}/{x}.png' } as MapSource;
    const map = buildSourceUrlMap([overridden]);
    expect(map['wmts-1'].tileUrlTemplate).toBe('https://override/{z}/{y}/{x}.png');
  });

  it('handles a mix of OGC and WMTS sources', () => {
    const map = buildSourceUrlMap([ogc, wmts]);
    expect(Object.keys(map)).toEqual(['ogc-1', 'wmts-1']);
    expect(map['ogc-1'].isWmts).toBeUndefined();
    expect(map['wmts-1'].isWmts).toBe(true);
  });
});

describe('buildHeaderAuthTransformRequest', () => {
  it('returns undefined when no sources use header auth', () => {
    expect(buildHeaderAuthTransformRequest([ogc])).toBeUndefined();
  });

  it('injects headers for OGC sources matched by URL prefix', () => {
    const withAuth: MapSource = { ...ogc, auth: { type: 'header', name: 'X-Key', value: 'abc' } };
    const fn = buildHeaderAuthTransformRequest([withAuth])!;
    expect(fn('https://example.com/ogc/collections/foo')).toEqual({
      url: 'https://example.com/ogc/collections/foo',
      headers: { 'X-Key': 'abc' },
    });
  });

  it('injects headers for WMTS sources matched by URL origin', () => {
    const withAuth: MapSource = {
      ...wmts,
      auth: { type: 'header', name: 'Authorization', value: 'Bearer t' },
    };
    const fn = buildHeaderAuthTransformRequest([withAuth])!;
    expect(fn('https://gibs.earthdata.nasa.gov/wmts/.../tile.jpg').headers).toEqual({
      Authorization: 'Bearer t',
    });
  });

  it('passes through unmatched URLs without headers', () => {
    const withAuth: MapSource = { ...ogc, auth: { type: 'header', name: 'X-Key', value: 'abc' } };
    const fn = buildHeaderAuthTransformRequest([withAuth])!;
    expect(fn('https://other-host.example.com/tile')).toEqual({
      url: 'https://other-host.example.com/tile',
    });
  });

  it('skips WMTS sources with malformed capabilitiesUrl rather than throwing', () => {
    const broken = { ...wmts, capabilitiesUrl: 'not a url', auth: { type: 'header' as const, name: 'X', value: 'Y' } } as MapSource;
    expect(() => buildHeaderAuthTransformRequest([broken])).not.toThrow();
  });
});

describe('createLatestTransformRequest', () => {
  it('passes the request through unchanged while the delegate is undefined', () => {
    const stable = createLatestTransformRequest(() => undefined);
    expect(stable('https://example.com/tile.png')).toEqual({ url: 'https://example.com/tile.png' });
  });

  it('keeps a stable identity but injects headers once a header-auth source loads', () => {
    // Mirrors the real bug: the map captures one stable transformRequest at
    // construction (delegate still undefined), then a header-auth WMTS source
    // arrives later and the SAME function must start injecting the header.
    let delegate: TransformRequestFn | undefined;
    const stable = createLatestTransformRequest(() => delegate);
    const tileUrl = 'https://gibs.earthdata.nasa.gov/wmts/best/tile.jpg';

    // Before sources load: no header.
    expect(stable(tileUrl)).toEqual({ url: tileUrl });

    // Source loads after the map mounted.
    delegate = buildHeaderAuthTransformRequest([
      { ...wmts, auth: { type: 'header', name: 'Authorization', value: 'Basic abc' } },
    ]);

    // Same stable function now injects the header.
    expect(stable(tileUrl)).toEqual({
      url: tileUrl,
      headers: { Authorization: 'Basic abc' },
    });
  });
});
