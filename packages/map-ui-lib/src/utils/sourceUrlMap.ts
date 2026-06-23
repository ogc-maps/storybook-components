import type { MapSource, SourceAuth } from '../types';
import { buildWmtsTileUrlTemplate, isOgcApiSource } from './wmts';

export interface SourceUrlEntry {
  url: string;
  tileMatrixSetId?: string;
  auth?: SourceAuth;
  /** Pre-computed tile URL template for WMTS sources. */
  tileUrlTemplate?: string;
  isWmts?: boolean;
}

export type SourceUrlMap = Record<string, SourceUrlEntry>;

export type TransformRequestFn = (url: string) => { url: string; headers?: Record<string, string> };

/**
 * Build a lookup map from source id → resolved URL fields used by raster/vector
 * layer renderers. WMTS sources get a pre-computed tile URL template (so the
 * renderer can treat the source uniformly), OGC API sources expose `url` and
 * `tileMatrixSetId` directly.
 */
export function buildSourceUrlMap(sources: MapSource[]): SourceUrlMap {
  const map: SourceUrlMap = {};
  for (const source of sources) {
    if (isOgcApiSource(source)) {
      map[source.id] = {
        url: source.url,
        tileMatrixSetId: source.tileMatrixSetId,
        auth: source.auth,
      };
    } else {
      map[source.id] = {
        url: '',
        auth: source.auth,
        isWmts: true,
        tileUrlTemplate:
          source.tileUrlTemplate ??
          buildWmtsTileUrlTemplate(
            source.capabilitiesUrl,
            source.layer,
            source.style,
            source.tileMatrixSet,
            source.format,
            source.auth,
          ),
      };
    }
  }
  return map;
}

/**
 * Build a MapLibre `transformRequest` that injects header auth for sources
 * declared with `auth.type === 'header'`. Returns `undefined` when no sources
 * need auth so the map can skip the per-request hook entirely.
 *
 * WMTS sources are matched by URL origin (tile path differs from capabilities
 * URL); OGC API sources by URL prefix.
 */
export function buildHeaderAuthTransformRequest(
  sources: MapSource[],
): TransformRequestFn | undefined {
  const headerSources: { value: string; auth: SourceAuth }[] = [];
  for (const source of sources) {
    if (source.auth?.type !== 'header') continue;
    if (isOgcApiSource(source)) {
      headerSources.push({ value: source.url.replace(/\/$/, ''), auth: source.auth });
    } else {
      try {
        headerSources.push({ value: new URL(source.capabilitiesUrl).origin, auth: source.auth });
      } catch {
        // skip sources with malformed capabilitiesUrl
      }
    }
  }
  if (headerSources.length === 0) return undefined;
  return (url: string) => {
    const match = headerSources.find((s) => url.startsWith(s.value));
    if (!match) return { url };
    return { url, headers: { [match.auth.name]: match.auth.value } };
  };
}

/**
 * Wrap an always-stable `transformRequest` that delegates to whatever
 * `getDelegate()` returns at call time. Lets a renderer hand MapLibre one stable
 * function at construction (react-map-gl v7 reads `transformRequest` only once,
 * at `new Map(...)`) while still honoring header-auth sources that load *after*
 * the map mounts. Passes the request through unchanged when there is no delegate.
 */
export function createLatestTransformRequest(
  getDelegate: () => TransformRequestFn | undefined,
): TransformRequestFn {
  return (url: string) => {
    const delegate = getDelegate();
    return delegate ? delegate(url) : { url };
  };
}
