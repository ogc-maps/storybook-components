import type { OgcQueryables, QueryableProperty } from './ogcApi';
import { fetchQueryables, fetchFeatures } from './ogcApi';
import type { AvailableProperty, StyleConfig } from '../types';

const GEOMETRY_REF_PATTERN = /geojson\.org\/schema\/(\w+)\.json/;

/** Returns true if the property definition references a GeoJSON geometry $ref. */
export function isGeometryProperty(prop: QueryableProperty): boolean {
  return !!prop.$ref && GEOMETRY_REF_PATTERN.test(prop.$ref);
}

/**
 * Extracts the geometry type name from a geojson.org schema $ref.
 * e.g. "https://geojson.org/schema/Point.json" → "Point"
 */
export function extractGeometryType(ref: string): string | null {
  const match = GEOMETRY_REF_PATTERN.exec(ref);
  return match ? match[1] : null;
}

/**
 * Maps a GeoJSON geometry type name to a MapLibre style type.
 * Returns null for geometry collection or unrecognised types.
 * Note: Point maps to 'circle' by default; 'symbol' is a manual choice.
 */
export function geometryTypeToStyleType(geomType: string): 'fill' | 'line' | 'circle' | 'symbol' | null {
  const lower = geomType.toLowerCase();
  if (lower.includes('polygon')) return 'fill';
  if (lower.includes('linestring')) return 'line';
  if (lower.includes('point')) return 'circle';
  return null;
}

/**
 * Maps a GeoJSON geometry type name to all suitable MapLibre style types.
 * Point returns both 'circle' and 'symbol'; others return a single type.
 * Returns an empty array for geometry collection or unrecognised types.
 */
export function geometryTypeToStyleTypes(geomType: string): ('fill' | 'line' | 'circle' | 'symbol')[] {
  const lower = geomType.toLowerCase();
  if (lower.includes('polygon')) return ['fill', 'line', 'symbol'];
  if (lower.includes('linestring')) return ['line', 'symbol'];
  if (lower.includes('point')) return ['circle', 'symbol'];
  return [];
}

/**
 * Scans all properties in a queryables document for a geometry $ref and
 * returns the derived style type, or null if none found.
 */
export function detectGeometryTypeFromQueryables(
  queryables: OgcQueryables,
): 'fill' | 'line' | 'circle' | 'symbol' | null {
  for (const prop of Object.values(queryables.properties)) {
    if (prop.$ref) {
      const geomType = extractGeometryType(prop.$ref);
      if (geomType) return geometryTypeToStyleType(geomType);
    }
  }
  return null;
}

/**
 * Scans all properties in a queryables document for a geometry $ref and
 * returns all suitable style types, or an empty array if none found.
 */
export function detectGeometryStyleTypesFromQueryables(
  queryables: OgcQueryables,
): ('fill' | 'line' | 'circle' | 'symbol')[] {
  for (const prop of Object.values(queryables.properties)) {
    if (prop.$ref) {
      const geomType = extractGeometryType(prop.$ref);
      if (geomType) return geometryTypeToStyleTypes(geomType);
    }
  }
  return [];
}

/**
 * Returns the names of all geometry properties in a queryables document.
 */
export function getGeometryPropertyNames(queryables: OgcQueryables): string[] {
  return Object.entries(queryables.properties)
    .filter(([, prop]) => isGeometryProperty(prop))
    .map(([name]) => name);
}

/**
 * Filters out geometry properties and maps the rest to AvailableProperty[].
 */
export function toAvailableProperties(queryables: OgcQueryables): AvailableProperty[] {
  return Object.entries(queryables.properties)
    .filter(([, prop]) => !isGeometryProperty(prop))
    .map(([name, prop]) => ({
      name,
      title: prop.title,
      type: prop.type,
      format: prop.format,
      enum: prop.enum,
      minimum: prop.minimum,
      maximum: prop.maximum,
    }));
}

/**
 * Scans a feature array and returns distinct canonical geometry types found.
 */
export function detectGeometryTypesFromFeatures(
  features: { geometry?: { type?: string } | null }[],
): string[] {
  const types = new Set<string>();
  for (const f of features) {
    if (f.geometry?.type) {
      types.add(f.geometry.type);
    }
  }
  return Array.from(types);
}

/**
 * Builds default StyleConfig objects for the given geometry type names.
 * For mixed collections (multiple geometry families), each style gets a
 * `geometryFilter` so MapLibre only renders matching features.
 */
export function buildDefaultStylesForGeometryTypes(geomTypes: string[]): StyleConfig[] {
  const families = new Set<'point' | 'line' | 'polygon'>();
  for (const t of geomTypes) {
    const lower = t.toLowerCase();
    if (lower.includes('polygon')) families.add('polygon');
    else if (lower.includes('linestring')) families.add('line');
    else if (lower.includes('point')) families.add('point');
  }

  const needsFilter = families.size > 1;
  const styles: StyleConfig[] = [];

  if (families.has('polygon')) {
    styles.push({
      type: 'fill',
      paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.6, 'fill-outline-color': 'transparent', 'fill-antialias': true },
      ...(needsFilter ? { geometryFilter: ['Polygon', 'MultiPolygon'] } : {}),
    });
  }
  if (families.has('line')) {
    styles.push({
      type: 'line',
      paint: { 'line-color': '#2980b9', 'line-width': 2, 'line-opacity': 1 },
      ...(needsFilter ? { geometryFilter: ['LineString', 'MultiLineString'] } : {}),
    });
  }
  if (families.has('point')) {
    styles.push({
      type: 'circle',
      paint: { 'circle-color': '#e74c3c', 'circle-radius': 5, 'circle-opacity': 0.9 },
      ...(needsFilter ? { geometryFilter: ['Point', 'MultiPoint'] } : {}),
    });
  }

  return styles;
}

/**
 * Decides what to do with a layer's styles when its collection geometry changes
 * and a fresh set of geometry-appropriate default styles has been detected.
 *
 * - `'apply'`: there were no styles, OR the current styles are exactly the ones
 *   we previously auto-applied (still untouched defaults) — safe to replace.
 * - `'keep'`: the current styles already equal the newly-detected defaults —
 *   nothing to do.
 * - `'warn'`: the user customized the styles, so replacing would clobber their
 *   work — surface a warning and let them choose.
 *
 * `lastAutoApplied` is the styles array we last auto-applied (or null if we
 * never have). Comparison is structural (JSON), which is sufficient for these
 * plain config objects.
 */
export function resolveStyleReapplyAction(
  current: StyleConfig[] | undefined,
  detected: StyleConfig[],
  lastAutoApplied: StyleConfig[] | null,
): 'apply' | 'keep' | 'warn' {
  if (detected.length === 0) return 'keep';
  if (!current || current.length === 0) return 'apply';
  const currentJson = JSON.stringify(current);
  if (currentJson === JSON.stringify(detected)) return 'keep';
  if (lastAutoApplied !== null && currentJson === JSON.stringify(lastAutoApplied)) {
    return 'apply';
  }
  return 'warn';
}

/**
 * Detects the geometry type for a collection and returns the corresponding
 * MapLibre style type. Tries queryables first, falls back to fetching one feature.
 * Returns null if detection fails.
 */
export async function detectStyleTypeForCollection(
  baseUrl: string,
  collectionId: string,
): Promise<'fill' | 'line' | 'circle' | 'symbol' | null> {
  try {
    const queryables = await fetchQueryables(baseUrl, collectionId);
    const styleType = detectGeometryTypeFromQueryables(queryables);
    if (styleType) return styleType;
  } catch { /* fall through */ }

  try {
    const fc = await fetchFeatures(baseUrl, collectionId, { limit: 1 });
    const geomType = fc.features[0]?.geometry?.type;
    if (typeof geomType === 'string') return geometryTypeToStyleType(geomType);
  } catch { /* ignore */ }

  return null;
}

/**
 * Detects all suitable style types for a collection.
 * Tries queryables first, falls back to fetching 20 features to detect mixed geometry.
 * Returns an empty array if detection fails.
 */
export async function detectStyleTypesForCollection(
  baseUrl: string,
  collectionId: string,
): Promise<('fill' | 'line' | 'circle' | 'symbol')[]> {
  try {
    const queryables = await fetchQueryables(baseUrl, collectionId);
    const styleTypes = detectGeometryStyleTypesFromQueryables(queryables);
    if (styleTypes.length > 0) return styleTypes;
  } catch { /* fall through */ }

  try {
    const fc = await fetchFeatures(baseUrl, collectionId, { limit: 20 });
    const geomTypes = detectGeometryTypesFromFeatures(fc.features);
    const allTypes = new Set<'fill' | 'line' | 'circle' | 'symbol'>();
    for (const gt of geomTypes) {
      for (const st of geometryTypeToStyleTypes(gt)) {
        allTypes.add(st);
      }
    }
    return Array.from(allTypes);
  } catch { /* ignore */ }

  return [];
}

/**
 * Converts a snake_case or camelCase property name to a human-readable label.
 * e.g. "pop_est" → "Pop Est", "countryName" → "Country Name"
 */
export function humanizePropertyName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
