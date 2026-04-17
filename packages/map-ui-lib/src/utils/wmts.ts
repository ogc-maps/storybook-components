import type { SourceAuth } from '../types';
import { appendAuth } from './ogcApi';

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
  // Derive base URL from capabilities URL by stripping the file/query part
  const base = capabilitiesUrl
    .replace(/\/GetCapabilities\.xml.*$/i, '')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '');

  const ext = formatToExtension(format);
  const template = `${base}/${encodeURIComponent(layer)}/${encodeURIComponent(style)}/${encodeURIComponent(tileMatrixSet)}/{z}/{y}/{x}.${ext}`;
  return appendAuth(template, auth);
}

/**
 * Convert a raw ResourceURL template from WMTS GetCapabilities to a MapLibre tile URL.
 * Replaces {TileMatrix}, {TileRow}, {TileCol} with MapLibre's {z}, {y}, {x}.
 */
export function adaptResourceUrlTemplate(template: string, auth?: SourceAuth): string {
  const adapted = template
    .replace(/\{TileMatrix\}/gi, '{z}')
    .replace(/\{TileRow\}/gi, '{y}')
    .replace(/\{TileCol\}/gi, '{x}');
  return appendAuth(adapted, auth);
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
 * Uses the browser's native DOMParser — not available in Node environments.
 */
export function parseWmtsCapabilities(xml: string): WmtsCapabilities {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const layerEls = doc.querySelectorAll('Contents > Layer');
  const layers: WmtsLayer[] = [];

  layerEls.forEach((el) => {
    const id = el.querySelector(':scope > Identifier')?.textContent?.trim() ?? '';
    const title = el.querySelector(':scope > Title')?.textContent?.trim();
    if (!id) return;

    const styles = Array.from(el.querySelectorAll(':scope > Style > Identifier'))
      .map((s) => s.textContent?.trim() ?? '')
      .filter(Boolean);

    const tileMatrixSets = Array.from(el.querySelectorAll(':scope > TileMatrixSetLink > TileMatrixSet'))
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
 * @throws {Error} if the fetch fails or the response is not OK.
 */
export async function fetchWmtsCapabilities(
  capabilitiesUrl: string,
  auth?: SourceAuth,
): Promise<WmtsCapabilities> {
  const headers: Record<string, string> = {};
  if (auth?.type === 'header') {
    headers[auth.name] = auth.value;
  }

  let url = capabilitiesUrl;
  if (auth?.type === 'query_param') {
    const sep = url.includes('?') ? '&' : '?';
    url = `${url}${sep}${encodeURIComponent(auth.name)}=${encodeURIComponent(auth.value)}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`WMTS GetCapabilities failed: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  return parseWmtsCapabilities(xml);
}
