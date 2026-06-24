import type { MapSource, OgcApiSource, WmtsSource, SourceAuth } from '../types';
import { appendAuth, authHeaders } from './ogcApi';

/**
 * Type guard: true if a `MapSource` is an OGC API source (no `sourceType` literal).
 * Use this before reading `.url` / `.tileMatrixSetId` / `.type` on a `MapSource`,
 * since the union also includes WMTS sources that have neither.
 */
export function isOgcApiSource(source: MapSource): source is OgcApiSource {
  return !('sourceType' in source && source.sourceType === 'wmts');
}

/**
 * Type guard: true if a `MapSource` is a WMTS source. The inverse of
 * `isOgcApiSource`, but narrows to `WmtsSource` so `.capabilitiesUrl` / `.layer`
 * are readable.
 */
export function isWmtsSource(source: MapSource): source is WmtsSource {
  return 'sourceType' in source && source.sourceType === 'wmts';
}

/**
 * True if a source plays the *imagery* role — i.e. it can back an imagery layer.
 * WMTS is intrinsically tiled raster imagery; OGC API sources opt in via
 * `type: 'imagery'`. Use this (not `isOgcApiSource`) when filtering the source
 * list that feeds the imagery layer pickers.
 */
export function isImagerySource(source: MapSource): boolean {
  return isWmtsSource(source) || (isOgcApiSource(source) && source.type === 'imagery');
}

/** A `<Dimension>` (e.g. `Time`) and its advertised default value. */
export interface WmtsDimension {
  id: string;
  default?: string;
}

/** A tile `<ResourceURL>` template plus the image format it serves. */
export interface WmtsTileResourceUrl {
  template: string;
  format?: string;
}

export interface WmtsLayer {
  id: string;
  title?: string;
  styles: string[];
  tileMatrixSets: string[];
  formats: string[];
  /** All tile ResourceURL templates, one per advertised format. */
  tileResourceUrls?: WmtsTileResourceUrl[];
  /** Dimensions (e.g. `Time`) advertised by the layer, with their defaults. */
  dimensions?: WmtsDimension[];
}

export interface WmtsCapabilities {
  layers: WmtsLayer[];
}

/**
 * Build a MapLibre-compatible raster tile URL template from WMTS RESTful parameters.
 * Translates WMTS placeholders to MapLibre's {z}/{x}/{y} convention.
 */
export function buildWmtsTileUrlTemplate(
  capabilitiesUrl: string,
  layer: string,
  style: string,
  tileMatrixSet: string,
  format: string,
  auth?: SourceAuth,
): string {
  const base = capabilitiesUrl
    // Strip a trailing GetCapabilities path — `.xml` is optional so this also
    // handles `…/wmts/GetCapabilities` (no extension).
    .replace(/\/(?:get|wmts)?capabilities(?:\.xml)?.*$/i, '')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '')
    // Drop a trailing version segment like `/1.0.0` that belongs to the
    // capabilities path, not the REST tile path (e.g. GIBS `…/best/1.0.0`).
    .replace(/\/\d+\.\d+\.\d+$/, '');

  const ext = formatToExtension(format);
  const template = `${base}/${encodeURIComponent(layer)}/${encodeURIComponent(style)}/${encodeURIComponent(tileMatrixSet)}/{z}/{y}/{x}.${ext}`;
  return appendAuth(template, auth);
}

/**
 * Resolve a layer's advertised tile `<ResourceURL>` template into a
 * MapLibre-ready URL template, filling WMTS placeholders. Prefer this over
 * `buildWmtsTileUrlTemplate` (which hand-builds the path and guesses wrong for
 * servers whose REST layout differs from `{base}/{layer}/{style}/{tms}/…`).
 *
 * Returns `null` when the layer advertises no tile ResourceURL, or when the
 * template contains a placeholder we can't resolve (an unmodeled dimension) —
 * in both cases the caller falls back to `buildWmtsTileUrlTemplate` rather than
 * baking a wrong URL. The returned template carries no auth; the renderer
 * appends query auth / injects header auth.
 */
export function resolveWmtsTileUrlTemplate(
  layer: WmtsLayer,
  opts: { style: string; tileMatrixSet: string; format?: string },
): string | null {
  const candidates = layer.tileResourceUrls ?? [];
  if (candidates.length === 0) return null;
  const chosen =
    (opts.format ? candidates.find((c) => c.format === opts.format) : undefined) ?? candidates[0];

  let url = chosen.template
    .replace(/\{TileMatrixSet\}/gi, opts.tileMatrixSet)
    .replace(/\{TileMatrix\}/gi, '{z}')
    .replace(/\{TileRow\}/gi, '{y}')
    .replace(/\{TileCol\}/gi, '{x}')
    .replace(/\{Style\}/gi, opts.style)
    .replace(/\{Layer\}/gi, layer.id);

  // Fill remaining placeholders from the layer's advertised dimension defaults
  // (e.g. {Time}). Keep the MapLibre {z}/{y}/{x} tokens; bail to null on any
  // placeholder we can't resolve so the caller falls back instead of guessing.
  const dimDefaults = new Map(
    (layer.dimensions ?? []).map((d) => [d.id.toLowerCase(), d.default ?? 'default']),
  );
  let unresolved = false;
  url = url.replace(/\{([^}]+)\}/g, (token, name: string) => {
    if (/^[zyx]$/i.test(name)) return token;
    const value = dimDefaults.get(name.toLowerCase());
    if (value === undefined) {
      unresolved = true;
      return token;
    }
    return value;
  });

  return unresolved ? null : url;
}

function formatToExtension(format: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return map[format] ?? 'png';
}

/**
 * Parse a WMTS GetCapabilities XML response into a structured capabilities object.
 * Uses the browser's native DOMParser — not available in Node environments without jsdom.
 */
export function parseWmtsCapabilities(xml: string): WmtsCapabilities {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('WMTS capabilities response was not valid XML');
  }

  const layerEls = doc.querySelectorAll('Contents > Layer');
  const layers: WmtsLayer[] = [];

  layerEls.forEach((el) => {
    const id = el.querySelector(':scope > Identifier')?.textContent?.trim() ?? '';
    const title = el.querySelector(':scope > Title')?.textContent?.trim();
    if (!id) return;

    const styles = Array.from(el.querySelectorAll(':scope > Style > Identifier'))
      .map((s) => s.textContent?.trim() ?? '')
      .filter(Boolean);

    const tileMatrixSets = Array.from(
      el.querySelectorAll(':scope > TileMatrixSetLink > TileMatrixSet'),
    )
      .map((s) => s.textContent?.trim() ?? '')
      .filter(Boolean);

    const formats = Array.from(el.querySelectorAll(':scope > Format'))
      .map((s) => s.textContent?.trim() ?? '')
      .filter(Boolean);

    const tileResourceUrls = Array.from(
      el.querySelectorAll(':scope > ResourceURL[resourceType="tile"]'),
    )
      .map((r) => ({
        template: r.getAttribute('template') ?? '',
        format: r.getAttribute('format') ?? undefined,
      }))
      .filter((r) => r.template);

    const dimensions = Array.from(el.querySelectorAll(':scope > Dimension'))
      .map((d) => ({
        id: d.querySelector(':scope > Identifier')?.textContent?.trim() ?? '',
        default: d.querySelector(':scope > Default')?.textContent?.trim() || undefined,
      }))
      .filter((d) => d.id);

    layers.push({
      id,
      title,
      styles,
      tileMatrixSets,
      formats,
      tileResourceUrls,
      dimensions,
    });
  });

  return { layers };
}

/**
 * Fetch and parse a WMTS GetCapabilities document.
 * Pass an AbortSignal so the caller can cancel a slow request (e.g. on unmount).
 */
export async function fetchWmtsCapabilities(
  capabilitiesUrl: string,
  auth?: SourceAuth,
  signal?: AbortSignal,
): Promise<WmtsCapabilities> {
  const url = appendAuth(capabilitiesUrl, auth);
  const response = await fetch(url, { headers: authHeaders(auth), signal });
  if (!response.ok) {
    throw new Error(`WMTS GetCapabilities failed: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  return parseWmtsCapabilities(xml);
}
