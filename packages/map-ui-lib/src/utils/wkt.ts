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
