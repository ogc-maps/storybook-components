import type { MapSource } from '@ogc-maps/storybook-components';
import { isWmtsSource } from '@ogc-maps/storybook-components/utils';

/** Same-origin admin proxy base (Vite proxies `/api` → the server in dev). */
const PROXY_BASE = '/api/proxy';

/** Pull the `scheme://host[:port]` prefix off a URL **without** parsing it — a
 *  `new URL().pathname` round-trip would percent-encode the `{z}/{y}/{x}` braces
 *  and break MapLibre's placeholder substitution. */
function extractOrigin(url: string): string | null {
  const m = url.match(/^https?:\/\/[^/]+/i);
  return m ? m[0] : null;
}

/**
 * For the admin map preview: route a proxied WMTS source's `tileUrlTemplate`
 * through the same-origin server proxy, mirroring the published-config rewrite
 * in `server/index.ts` (`GET /api/configs/:name`). This keeps the preview faithful
 * to what public viewers get: tiles go to `/api/proxy/{id}/…` and the server
 * attaches the source's auth, so the credential never leaves the server and there
 * is no cross-origin/CORS hurdle.
 *
 * Only proxied WMTS sources with a resolved `tileUrlTemplate` are rewritten; every
 * other source passes through untouched. `auth` is dropped from the rewritten
 * source so the browser doesn't also try to inject it (the proxy owns it).
 */
export function proxifyWmtsSources(sources: MapSource[]): MapSource[] {
  return sources.map((s) => {
    if (!(s.proxy && isWmtsSource(s) && s.tileUrlTemplate)) return s;
    const origin = extractOrigin(s.tileUrlTemplate);
    if (!origin) return s;
    const path = s.tileUrlTemplate.substring(origin.length); // keeps {z}/{y}/{x}
    const { auth: _auth, ...rest } = s;
    return { ...rest, tileUrlTemplate: `${PROXY_BASE}/${s.id}${path}` };
  });
}
