/**
 * Format allowlist + detection. Two layers of defense:
 *  - `formatFromExtension` - fast classification from the filename.
 *  - `sniffMagicBytes` - authoritative check on the file's leading bytes, so a
 *    `.geojson` that is actually a zip (or vice-versa) is rejected.
 */
import type { FormatId } from './types.js';

export interface FormatDef {
  id: FormatId;
  label: string;
  extensions: string[];
  /** May contain multiple vector layers, so needs a layer-selection preflight. */
  multiLayer: boolean;
}

export const FORMATS: Record<FormatId, FormatDef> = {
  geojson: { id: 'geojson', label: 'GeoJSON', extensions: ['.geojson', '.json'], multiLayer: false },
  csv: { id: 'csv', label: 'CSV (WKT)', extensions: ['.csv'], multiLayer: false },
  kml: { id: 'kml', label: 'KML', extensions: ['.kml'], multiLayer: true },
  'shp-zip': { id: 'shp-zip', label: 'Shapefile (.zip)', extensions: ['.zip'], multiLayer: false },
  fgb: { id: 'fgb', label: 'FlatGeobuf', extensions: ['.fgb'], multiLayer: false },
  gpkg: { id: 'gpkg', label: 'GeoPackage', extensions: ['.gpkg'], multiLayer: true },
};

const EXTENSION_MAP: Record<string, FormatId> = {
  '.geojson': 'geojson',
  '.json': 'geojson',
  '.csv': 'csv',
  '.kml': 'kml',
  '.zip': 'shp-zip',
  '.fgb': 'fgb',
  '.gpkg': 'gpkg',
};

/** Lowercased extension including the dot, e.g. `.gpkg`. */
export function extname(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i).toLowerCase();
}

/** Classify by extension, or null if the extension is not allowed. */
export function formatFromExtension(filename: string): FormatId | null {
  return EXTENSION_MAP[extname(filename)] ?? null;
}

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  return sig.every((b, i) => buf[offset + i] === b);
}

const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const ZIP_EMPTY_SIG = [0x50, 0x4b, 0x05, 0x06];
// "SQLite format 3" + NUL terminator (GeoPackage is SQLite under the hood).
const SQLITE_SIG = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
const FGB_SIG = [0x66, 0x67, 0x62]; // "fgb" magic prefix

/**
 * Verify the file's leading bytes are consistent with the claimed format.
 * Binary formats are checked structurally; text formats (geojson/csv/kml) are
 * sniffed for being valid UTF-8 text with the expected shape.
 */
export function sniffMagicBytes(format: FormatId, buf: Uint8Array): boolean {
  switch (format) {
    case 'shp-zip':
      return startsWith(buf, ZIP_SIG) || startsWith(buf, ZIP_EMPTY_SIG);
    case 'gpkg':
      return startsWith(buf, SQLITE_SIG);
    case 'fgb':
      // FlatGeobuf magic: "fgb" <major> "fgb" <patch> in the first 8 bytes.
      return startsWith(buf, FGB_SIG) && startsWith(buf, FGB_SIG, 4);
    case 'geojson':
      return looksLikeJson(buf);
    case 'kml':
      return looksLikeXml(buf);
    case 'csv':
      return looksLikeText(buf);
    default:
      return false;
  }
}

function leadingText(buf: Uint8Array, max = 512): string {
  // Skip a UTF-8 BOM if present.
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  return Buffer.from(buf.slice(start, start + max)).toString('utf8');
}

function looksLikeText(buf: Uint8Array): boolean {
  // Reject obvious binary: a NUL byte in the first chunk.
  const head = buf.slice(0, 512);
  for (const b of head) {
    if (b === 0) return false;
  }
  return head.length > 0;
}

function looksLikeJson(buf: Uint8Array): boolean {
  if (!looksLikeText(buf)) return false;
  const t = leadingText(buf).trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

function looksLikeXml(buf: Uint8Array): boolean {
  if (!looksLikeText(buf)) return false;
  const t = leadingText(buf).trimStart().toLowerCase();
  return t.startsWith('<?xml') || t.startsWith('<kml') || t.includes('<kml');
}

/**
 * Resolve the effective format from an explicit choice (or `auto`) plus the
 * filename, then confirm it against magic bytes. Throws on disallowed or
 * mismatched files.
 */
export function resolveFormat(
  requested: FormatId | 'auto',
  filename: string,
  head: Uint8Array,
): FormatId {
  const byExt = formatFromExtension(filename);
  const format = requested === 'auto' ? byExt : requested;
  if (!format) {
    throw new Error(`Unsupported file type: ${extname(filename) || filename}`);
  }
  if (requested !== 'auto' && byExt && byExt !== requested) {
    throw new Error(`File extension ${extname(filename)} does not match format ${requested}`);
  }
  if (!sniffMagicBytes(format, head)) {
    throw new Error(`File contents do not look like ${FORMATS[format].label}`);
  }
  return format;
}
