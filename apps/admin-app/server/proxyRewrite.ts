// URL helpers + the published-config proxy rewrite. Kept DB-free so the rewrite
// is unit-testable directly (the live `GET /api/configs/:name` path builds the
// proxiedSources map from a SQL query that pg-mem can't run faithfully).

const ORIGIN_RE = /^(https?:\/\/[^/?#]+)/;

export function extractOrigin(url: string): string {
  return url.match(ORIGIN_RE)?.[1] ?? url.replace(/\/$/, '');
}

export function extractUrlPath(url: string): string {
  return (url.match(/^https?:\/\/[^/?#]+(.*?)(?:\?.*)?$/)?.[1] ?? '').replace(/\/$/, '');
}

export function stripQueryParams(url: string, paramNames: Set<string>): string {
  if (paramNames.size === 0) return url;
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return url;
  const base = url.substring(0, qIdx);
  const params = new URLSearchParams(url.substring(qIdx + 1));
  for (const name of paramNames) params.delete(name);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export interface ProxiedSourceInfo {
  url: string;
  origin: string;
  paramsToStrip: Set<string>;
}

interface RewritableSource {
  id: string;
  url: string;
  auth?: unknown;
  tileUrlTemplate?: string;
}
interface RewritableImageryLayer {
  sourceId?: string;
  tileUrlTemplate?: string;
}

/**
 * Rewrite a published config's proxied source/imagery URLs to point at the
 * `/api/proxy/:sourceId/*` endpoint, so the browser never sees the upstream
 * credential and cross-origin tiles flow through the server. Mutates `config`
 * in place.
 *
 * Three things get rewritten for a proxied source:
 *  - `source.url`
 *  - `source.tileUrlTemplate` (WMTS sources — the renderer uses this directly)
 *  - `imageryLayers[].tileUrlTemplate` referencing that source
 * The two tile-template rewrites apply an SSRF origin-match guard.
 */
export function rewriteProxiedConfigUrls(
  config: { sources?: RewritableSource[]; imageryLayers?: RewritableImageryLayer[] },
  proxiedSources: Map<string, ProxiedSourceInfo>,
  proxyBase: string,
): void {
  // Re-point a tile template at the proxy, but only when it shares the source's
  // origin (SSRF guard); otherwise leave it untouched.
  const proxifyTile = (template: string, id: string, info: ProxiedSourceInfo): string => {
    const origin = extractOrigin(template);
    if (origin !== info.origin) return template;
    const clean = stripQueryParams(template, info.paramsToStrip);
    return `${proxyBase}/${id}${clean.substring(origin.length)}`;
  };

  for (const source of config.sources ?? []) {
    const info = proxiedSources.get(source.id);
    if (!info) continue;
    source.url = `${proxyBase}/${source.id}${extractUrlPath(info.url)}`;
    if (source.tileUrlTemplate) {
      source.tileUrlTemplate = proxifyTile(source.tileUrlTemplate, source.id, info);
    }
    delete source.auth;
  }

  for (const layer of config.imageryLayers ?? []) {
    if (!layer.tileUrlTemplate || !layer.sourceId) continue;
    const info = proxiedSources.get(layer.sourceId);
    if (!info) continue;
    layer.tileUrlTemplate = proxifyTile(layer.tileUrlTemplate, layer.sourceId, info);
  }
}
