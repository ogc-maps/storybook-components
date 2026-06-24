import { describe, it, expect } from 'vitest';
import type { MapSource, WmtsSource } from '@ogc-maps/storybook-components';
import { proxifyWmtsSources } from '../proxyPreview';

const wmts = (over: Partial<MapSource> = {}): MapSource => ({
  id: 'gibs',
  sourceType: 'wmts',
  capabilitiesUrl: 'https://gibs.example/wmts/WMTSCapabilities.xml',
  layer: 'MODIS',
  style: 'default',
  format: 'image/jpeg',
  tileMatrixSet: 'GoogleMapsCompatible_Level9',
  tileSize: 256,
  tileUrlTemplate: 'https://gibs.example/best/MODIS/default/2026-06-23/Level9/{z}/{y}/{x}.jpeg',
  proxy: true,
  auth: { type: 'header', name: 'Authorization', value: 'Basic abc' },
  ...over,
}) as MapSource;

describe('proxifyWmtsSources', () => {
  it('rewrites a proxied WMTS template to /api/proxy and preserves {z}/{y}/{x}', () => {
    const out = proxifyWmtsSources([wmts()])[0] as WmtsSource;
    expect(out.tileUrlTemplate).toBe(
      '/api/proxy/gibs/best/MODIS/default/2026-06-23/Level9/{z}/{y}/{x}.jpeg',
    );
  });

  it('drops auth on the rewritten source (the proxy attaches it server-side)', () => {
    const out = proxifyWmtsSources([wmts()])[0] as WmtsSource;
    expect(out.auth).toBeUndefined();
  });

  it('leaves a non-proxied WMTS source untouched', () => {
    const src = wmts({ proxy: false });
    expect(proxifyWmtsSources([src])[0]).toBe(src);
  });

  it('leaves non-WMTS sources untouched', () => {
    const ogc: MapSource = {
      id: 'o',
      url: 'https://h/ogc',
      tileMatrixSetId: 'WebMercatorQuad',
      type: 'imagery',
      proxy: true,
    };
    expect(proxifyWmtsSources([ogc])[0]).toBe(ogc);
  });

  it('passes through a proxied WMTS source that has no resolved template', () => {
    const src = wmts({ tileUrlTemplate: undefined });
    expect(proxifyWmtsSources([src])[0]).toBe(src);
  });
});
