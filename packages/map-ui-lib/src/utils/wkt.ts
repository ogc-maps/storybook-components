type Coord = [number, number];
type Ring = Coord[];

function coordToWkt(coord: Coord): string {
  return `${coord[0]} ${coord[1]}`;
}

function ringToWkt(ring: Ring): string {
  return ring.map(coordToWkt).join(', ');
}

/**
 * Converts a GeoJSON geometry object to its WKT representation.
 * Accepts the loose `Record<string, unknown>` shape used by OGC API responses
 * so callers don't need an intermediate cast.
 */
export function geojsonGeometryToWkt(geometry: Record<string, unknown> | null | undefined): string {
  if (!geometry?.type) return '';

  switch (geometry.type) {
    case 'Point':
      return `POINT (${coordToWkt(geometry.coordinates as Coord)})`;

    case 'MultiPoint':
      return `MULTIPOINT (${(geometry.coordinates as Coord[]).map((c) => `(${coordToWkt(c)})`).join(', ')})`;

    case 'LineString':
      return `LINESTRING (${ringToWkt(geometry.coordinates as Ring)})`;

    case 'MultiLineString':
      return `MULTILINESTRING (${(geometry.coordinates as Ring[]).map((r) => `(${ringToWkt(r)})`).join(', ')})`;

    case 'Polygon':
      return `POLYGON (${(geometry.coordinates as Ring[]).map((r) => `(${ringToWkt(r)})`).join(', ')})`;

    case 'MultiPolygon':
      return `MULTIPOLYGON (${(geometry.coordinates as Ring[][]).map((poly) => `(${poly.map((r) => `(${ringToWkt(r)})`).join(', ')})`).join(', ')})`;

    case 'GeometryCollection':
      return `GEOMETRYCOLLECTION (${((geometry.geometries as Record<string, unknown>[]) ?? []).map(geojsonGeometryToWkt).join(', ')})`;

    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// WKT -> GeoJSON (reverse of geojsonGeometryToWkt)
// ---------------------------------------------------------------------------

interface Cursor {
  s: string;
  i: number;
}

function skipWs(p: Cursor): void {
  while (p.i < p.s.length && /\s/.test(p.s.charAt(p.i))) p.i++;
}

/** Consume the given character (after whitespace). Returns false if absent. */
function eat(p: Cursor, ch: string): boolean {
  skipWs(p);
  if (p.s.charAt(p.i) === ch) {
    p.i++;
    return true;
  }
  return false;
}

function peek(p: Cursor): string {
  skipWs(p);
  return p.s.charAt(p.i);
}

const NUMBER_START = /[-+0-9.]/;
const NUMBER_CHAR = /[-+0-9.eE]/;

function parseNumber(p: Cursor): number | null {
  skipWs(p);
  const start = p.i;
  while (p.i < p.s.length && NUMBER_CHAR.test(p.s.charAt(p.i))) p.i++;
  if (p.i === start) return null;
  const n = Number(p.s.slice(start, p.i));
  return Number.isFinite(n) ? n : null;
}

/** A position: two or more whitespace-separated numbers (x y [z [m]]). */
function parsePosition(p: Cursor): number[] | null {
  const nums: number[] = [];
  for (;;) {
    skipWs(p);
    if (p.i >= p.s.length || !NUMBER_START.test(p.s.charAt(p.i))) break;
    const n = parseNumber(p);
    if (n === null) return null;
    nums.push(n);
  }
  return nums.length >= 2 ? nums : null;
}

/** `(p1, p2, ...)` — a ring / linestring coordinate list. */
function parsePositionList(p: Cursor): number[][] | null {
  if (!eat(p, '(')) return null;
  const coords: number[][] = [];
  for (;;) {
    const c = parsePosition(p);
    if (!c) return null;
    coords.push(c);
    if (eat(p, ',')) continue;
    break;
  }
  if (!eat(p, ')')) return null;
  return coords;
}

/** `((..), (..))` — list of rings (polygon / multilinestring). */
function parsePositionListList(p: Cursor): number[][][] | null {
  if (!eat(p, '(')) return null;
  const out: number[][][] = [];
  for (;;) {
    const ring = parsePositionList(p);
    if (!ring) return null;
    out.push(ring);
    if (eat(p, ',')) continue;
    break;
  }
  if (!eat(p, ')')) return null;
  return out;
}

/** `(((..)), ((..)))` — list of polygons (multipolygon). */
function parsePositionListListList(p: Cursor): number[][][][] | null {
  if (!eat(p, '(')) return null;
  const out: number[][][][] = [];
  for (;;) {
    const poly = parsePositionListList(p);
    if (!poly) return null;
    out.push(poly);
    if (eat(p, ',')) continue;
    break;
  }
  if (!eat(p, ')')) return null;
  return out;
}

/**
 * MULTIPOINT accepts both `(1 2, 3 4)` and `((1 2), (3 4))`. Each member may or
 * may not be wrapped in its own parens.
 */
function parseMultiPointBody(p: Cursor): number[][] | null {
  if (!eat(p, '(')) return null;
  if (peek(p) === ')') {
    p.i++;
    return [];
  }
  const coords: number[][] = [];
  for (;;) {
    let c: number[] | null;
    if (peek(p) === '(') {
      p.i++;
      c = parsePosition(p);
      if (!c || !eat(p, ')')) return null;
    } else {
      c = parsePosition(p);
      if (!c) return null;
    }
    coords.push(c);
    if (eat(p, ',')) continue;
    break;
  }
  if (!eat(p, ')')) return null;
  return coords;
}

function parseGeometryCollectionBody(p: Cursor): GeoJSON.Geometry[] | null {
  if (!eat(p, '(')) return null;
  if (peek(p) === ')') {
    p.i++;
    return [];
  }
  const geoms: GeoJSON.Geometry[] = [];
  for (;;) {
    const g = parseTaggedGeometry(p);
    if (!g) return null;
    geoms.push(g);
    if (eat(p, ',')) continue;
    break;
  }
  if (!eat(p, ')')) return null;
  return geoms;
}

/** Match a trailing `EMPTY` token (word-bounded), consuming it if present. */
function tryEmpty(p: Cursor): boolean {
  skipWs(p);
  if (p.s.slice(p.i, p.i + 5).toUpperCase() === 'EMPTY') {
    const after = p.s.charAt(p.i + 5);
    if (after === '' || /\s/.test(after)) {
      p.i += 5;
      return true;
    }
  }
  return false;
}

function emptyGeometryFor(keyword: string): GeoJSON.Geometry | null {
  switch (keyword) {
    case 'POINT':
      return { type: 'Point', coordinates: [] } as unknown as GeoJSON.Point;
    case 'MULTIPOINT':
      return { type: 'MultiPoint', coordinates: [] };
    case 'LINESTRING':
      return { type: 'LineString', coordinates: [] };
    case 'MULTILINESTRING':
      return { type: 'MultiLineString', coordinates: [] };
    case 'POLYGON':
      return { type: 'Polygon', coordinates: [] };
    case 'MULTIPOLYGON':
      return { type: 'MultiPolygon', coordinates: [] };
    case 'GEOMETRYCOLLECTION':
      return { type: 'GeometryCollection', geometries: [] };
    default:
      return null;
  }
}

function parseTaggedGeometry(p: Cursor): GeoJSON.Geometry | null {
  skipWs(p);
  const start = p.i;
  while (p.i < p.s.length && /[A-Za-z]/.test(p.s.charAt(p.i))) p.i++;
  const keyword = p.s.slice(start, p.i).toUpperCase();
  if (!keyword) return null;

  if (tryEmpty(p)) return emptyGeometryFor(keyword);

  switch (keyword) {
    case 'POINT': {
      if (!eat(p, '(')) return null;
      const c = parsePosition(p);
      if (!c || !eat(p, ')')) return null;
      return { type: 'Point', coordinates: c as GeoJSON.Position };
    }
    case 'MULTIPOINT': {
      const c = parseMultiPointBody(p);
      return c ? { type: 'MultiPoint', coordinates: c as GeoJSON.Position[] } : null;
    }
    case 'LINESTRING': {
      const c = parsePositionList(p);
      return c ? { type: 'LineString', coordinates: c as GeoJSON.Position[] } : null;
    }
    case 'MULTILINESTRING': {
      const c = parsePositionListList(p);
      return c ? { type: 'MultiLineString', coordinates: c as GeoJSON.Position[][] } : null;
    }
    case 'POLYGON': {
      const c = parsePositionListList(p);
      return c ? { type: 'Polygon', coordinates: c as GeoJSON.Position[][] } : null;
    }
    case 'MULTIPOLYGON': {
      const c = parsePositionListListList(p);
      return c ? { type: 'MultiPolygon', coordinates: c as GeoJSON.Position[][][] } : null;
    }
    case 'GEOMETRYCOLLECTION': {
      const g = parseGeometryCollectionBody(p);
      return g ? { type: 'GeometryCollection', geometries: g } : null;
    }
    default:
      return null;
  }
}

/**
 * Parse a WKT string into a GeoJSON geometry. The exact inverse of
 * {@link geojsonGeometryToWkt} for valid 2D geometries.
 *
 * Supports Point, MultiPoint, LineString, MultiLineString, Polygon,
 * MultiPolygon and (nested) GeometryCollection. Keywords are case-insensitive
 * and extra whitespace is tolerated. `MULTIPOINT` accepts both the
 * `(1 2, 3 4)` and `((1 2), (3 4))` member forms.
 *
 * `<TYPE> EMPTY` parses to a geometry with empty `coordinates` (or empty
 * `geometries` for a collection), e.g. `POINT EMPTY` -> `{type:'Point',
 * coordinates: []}`.
 *
 * Returns `null` on any parse failure — never throws.
 */
export function wktToGeojsonGeometry(wkt: string): GeoJSON.Geometry | null {
  if (typeof wkt !== 'string') return null;
  const p: Cursor = { s: wkt, i: 0 };
  const geom = parseTaggedGeometry(p);
  if (!geom) return null;
  skipWs(p);
  // Reject trailing junk after a complete geometry.
  if (p.i !== p.s.length) return null;
  return geom;
}
