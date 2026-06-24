import { describe, it, expect } from 'vitest';
import {
  rewriteProxiedConfigUrls,
  extractOrigin,
  extractUrlPath,
  stripQueryParams,
  type ProxiedSourceInfo,
} from '../proxyRewrite.js';

const proxied = (over: Partial<ProxiedSourceInfo> = {}): Map<string, ProxiedSourceInfo> =>
  new Map([
    [
      'gibs',
      {
        url: 'https://api.gic.org/wmts/WMTSCapabilities.xml',
        origin: 'https://api.gic.org',
        paramsToStrip: new Set<string>(),
        ...over,
      },
    ],
  ]);

const BASE = 'https://admin.example/api/proxy';

describe('rewriteProxiedConfigUrls', () => {
  it('rewrites a WMTS source-level tileUrlTemplate to the proxy, preserving {z}/{y}/{x}, and drops auth', () => {
    const config = {
      sources: [
        {
          id: 'gibs',
          url: 'https://api.gic.org/wmts/WMTSCapabilities.xml',
          tileUrlTemplate: 'https://api.gic.org/wmts/bluesky-ultra-g/RGB/Set/{z}/{y}/{x}.png',
          auth: { type: 'header', name: 'Authorization', value: 'Basic abc' },
        },
      ],
    };
    rewriteProxiedConfigUrls(config, proxied(), BASE);
    expect(config.sources[0].tileUrlTemplate).toBe(
      'https://admin.example/api/proxy/gibs/wmts/bluesky-ultra-g/RGB/Set/{z}/{y}/{x}.png',
    );
    expect(config.sources[0].url).toBe('https://admin.example/api/proxy/gibs/wmts/WMTSCapabilities.xml');
    expect(config.sources[0].auth).toBeUndefined();
  });

  it('also rewrites an imageryLayers[].tileUrlTemplate referencing the proxied source', () => {
    const config = {
      sources: [{ id: 'gibs', url: 'https://api.gic.org/wmts/WMTSCapabilities.xml' }],
      imageryLayers: [
        { sourceId: 'gibs', tileUrlTemplate: 'https://api.gic.org/tiles/{z}/{y}/{x}.png' },
      ],
    };
    rewriteProxiedConfigUrls(config, proxied(), BASE);
    expect(config.imageryLayers[0].tileUrlTemplate).toBe(
      'https://admin.example/api/proxy/gibs/tiles/{z}/{y}/{x}.png',
    );
  });

  it('skips a cross-origin tile template (SSRF guard)', () => {
    const config = {
      sources: [
        {
          id: 'gibs',
          url: 'https://api.gic.org/wmts/WMTSCapabilities.xml',
          tileUrlTemplate: 'https://evil.example/{z}/{y}/{x}.png',
        },
      ],
    };
    rewriteProxiedConfigUrls(config, proxied(), BASE);
    expect(config.sources[0].tileUrlTemplate).toBe('https://evil.example/{z}/{y}/{x}.png');
  });

  it('leaves non-proxied sources untouched', () => {
    const config = {
      sources: [
        { id: 'other', url: 'https://h/x', tileUrlTemplate: 'https://h/{z}/{y}/{x}.png', auth: { type: 'header', name: 'A', value: 'B' } },
      ],
    };
    rewriteProxiedConfigUrls(config, proxied(), BASE);
    expect(config.sources[0].url).toBe('https://h/x');
    expect(config.sources[0].auth).toBeDefined();
  });

  it('strips the source auth query param from the proxied template', () => {
    const config = {
      sources: [
        { id: 'gibs', url: 'https://api.gic.org/wmts?key=secret', tileUrlTemplate: 'https://api.gic.org/{z}/{y}/{x}.png?key=secret' },
      ],
    };
    rewriteProxiedConfigUrls(config, proxied({ paramsToStrip: new Set(['key']) }), BASE);
    expect(config.sources[0].tileUrlTemplate).toBe('https://admin.example/api/proxy/gibs/{z}/{y}/{x}.png');
  });
});

describe('url helpers', () => {
  it('extractOrigin returns scheme://host', () => {
    expect(extractOrigin('https://api.gic.org/wmts/x?a=1')).toBe('https://api.gic.org');
  });
  it('extractUrlPath returns the path without trailing slash or query', () => {
    expect(extractUrlPath('https://api.gic.org/wmts/caps.xml?a=1')).toBe('/wmts/caps.xml');
  });
  it('stripQueryParams removes only named params', () => {
    expect(stripQueryParams('https://h/x?key=1&z=2', new Set(['key']))).toBe('https://h/x?z=2');
  });
});
