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

export interface WmtsLayer {
  id: string;
  title?: string;
  styles: string[];
  tileMatrixSets: string[];
  formats: string[];
  /** RESTful tile URL template from ResourceURL, if present. */
  resourceUrlTemplate?: string;
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
    .replace(/\/(?:get|wmts)?capabilities\.xml.*$/i, '')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '');

  const ext = formatToExtension(format);
  const template = `${base}/${encodeURIComponent(layer)}/${encodeURIComponent(style)}/${encodeURIComponent(tileMatrixSet)}/{z}/{y}/{x}.${ext}`;
  return appendAuth(template, auth);
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

    const resourceUrlEl = el.querySelector(':scope > ResourceURL[resourceType="tile"]');
    const resourceUrlTemplate = resourceUrlEl?.getAttribute('template') ?? undefined;

    layers.push({ id, title, styles, tileMatrixSets, formats, resourceUrlTemplate });
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
