// OGC API utility functions - pure fetch functions with no React dependencies
import type { CQL2Expression } from './cql2';
import type { SourceAuth } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single OGC API collection. */
export interface OgcCollection {
  id: string;
  title?: string;
  description?: string;
  links: Array<{ href: string; rel: string; type?: string; title?: string }>;
  extent?: {
    spatial?: { bbox?: number[][]; crs?: string };
    temporal?: { interval?: Array<[string | null, string | null]> };
  };
  itemType?: string;
}

/** The OGC API /collections response. */
export interface OgcCollectionsResponse {
  collections: OgcCollection[];
  links: Array<{ href: string; rel: string; type?: string }>;
}

/** A GeoJSON Feature. */
export interface GeoJsonFeature {
  type: 'Feature';
  id?: string | number;
  geometry: Record<string, unknown>;
  properties: Record<string, unknown> | null;
}

/** A GeoJSON FeatureCollection with optional OGC numberMatched / numberReturned. */
export interface OgcFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
  numberMatched?: number;
  numberReturned?: number;
  links?: Array<{ href: string; rel: string; type?: string }>;
}

/** A single queryable property definition (OGC API schemajson format). */
export interface QueryableProperty {
  name?: string;
  type?: string;
  $ref?: string;
  title?: string;
  description?: string;
  format?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

/** OGC API queryables response (schemajson format). */
export interface OgcQueryables {
  $id?: string;
  $schema?: string;
  type: string;
  title?: string;
  properties: Record<string, QueryableProperty>;
}

/** OGC API conformance response. */
export interface OgcConformance {
  conformsTo: string[];
}

/** TileJSON response for a vector tile layer. */
export interface TileJson {
  tilejson: string;
  tiles: string[];
  name?: string;
  description?: string;
  minzoom?: number;
  maxzoom?: number;
  bounds?: [number, number, number, number];
  center?: [number, number, number];
  vector_layers?: Array<{
    id: string;
    description?: string;
    fields?: Record<string, string>;
  }>;
  /** Non-standard extension (MapTiler): tile scale factor. "2.000000" or 2 means 512px tiles. */
  scale?: string | number;
}

/** Derive tileSize from TileJSON scale field. Returns 512 for @2x tiles, 256 otherwise. */
export function tileSizeFromTileJson(tj: TileJson): number {
  return (Number(tj.scale) || 1) >= 2 ? 512 : 256;
}

/** Options for fetchFeatures. */
export interface FetchFeaturesOptions {
  bbox?: [number, number, number, number];
  limit?: number;
  offset?: number;
  properties?: string[];
  datetime?: string;
  /** @deprecated Use cql2Filter instead. Simple key-value equality filters. */
  filter?: Record<string, string | number>;
  /** CQL2 JSON filter expression. When provided, takes precedence over filter. */
  cql2Filter?: CQL2Expression;
  /** Sort fields for OGC API sortby parameter. */
  sortby?: Array<{ property: string; direction: 'asc' | 'desc' }>;
}

export type { SourceAuth };

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** Append query-param auth to a URL. No-op for header auth or undefined. */
export function appendAuth(url: string, auth?: SourceAuth): string {
  if (!auth || auth.type !== 'query_param') return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${encodeURIComponent(auth.name)}=${encodeURIComponent(auth.value)}`;
}

/** Build headers object for header auth. Empty for query-param auth or undefined. */
export function authHeaders(auth?: SourceAuth): Record<string, string> {
  if (!auth || auth.type !== 'header') return {};
  return { [auth.name]: auth.value };
}

async function fetchJson<T>(url: string, auth?: SourceAuth, signal?: AbortSignal): Promise<T> {
  const res = await fetch(appendAuth(url, auth), { headers: authHeaders(auth), signal });
  if (!res.ok) {
    throw new Error(`OGC API request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json() as Promise<T>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch the list of collections from an OGC API endpoint.
 * @throws {Error} If the request fails or the response status is not OK.
 */
export async function fetchCollections(baseUrl: string, auth?: SourceAuth): Promise<OgcCollection[]> {
  const url = `${stripTrailingSlash(baseUrl)}/collections?f=json`;
  const data = await fetchJson<OgcCollectionsResponse>(url, auth);
  return data.collections;
}

/**
 * Fetch GeoJSON features from an OGC API collection.
 * @throws {Error} If the request fails or the response status is not OK.
 */
export async function fetchFeatures(
  baseUrl: string,
  collection: string,
  options: FetchFeaturesOptions = {},
  auth?: SourceAuth,
  signal?: AbortSignal,
): Promise<OgcFeatureCollection> {
  const base = stripTrailingSlash(baseUrl);
  const params = new URLSearchParams({ f: 'geojson' });

  if (options.limit != null) params.set('limit', String(options.limit));
  if (options.offset != null) params.set('offset', String(options.offset));
  if (options.bbox) params.set('bbox', options.bbox.join(','));
  if (options.properties?.length) params.set('properties', options.properties.join(','));
  if (options.datetime) params.set('datetime', options.datetime);
  if (options.sortby?.length) {
    params.set('sortby', options.sortby.map((s) => `${s.direction === 'desc' ? '-' : '+'}${s.property}`).join(','));
  }
  if (options.cql2Filter) {
    params.set('filter-lang', 'cql2-json');
    params.set('filter', JSON.stringify(options.cql2Filter));
  } else if (options.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      params.set(key, String(value));
    }
  }

  const url = `${base}/collections/${encodeURIComponent(collection)}/items?${params}`;
  return fetchJson<OgcFeatureCollection>(url, auth, signal);
}

/**
 * Fetch a single feature by ID from an OGC API collection.
 *
 * Unlike other fetch functions in this module, this function catches errors
 * and returns `null` instead of throwing. This is intentional: "find by ID"
 * is a lookup pattern where not-found (404) is an expected outcome, not an
 * exceptional condition.
 *
 * @returns The feature if found, or `null` if not found or the request fails.
 */
export async function fetchFeatureById(
  baseUrl: string,
  collection: string,
  featureId: string | number,
  auth?: SourceAuth,
): Promise<GeoJsonFeature | null> {
  const base = stripTrailingSlash(baseUrl);
  const url = `${base}/collections/${encodeURIComponent(collection)}/items/${encodeURIComponent(String(featureId))}?f=geojson`;
  try {
    return await fetchJson<GeoJsonFeature>(url, auth);
  } catch {
    return null;
  }
}

/**
 * Fetch queryable properties for a collection.
 * @throws {Error} If the request fails or the response status is not OK.
 */
export async function fetchQueryables(
  baseUrl: string,
  collection: string,
  auth?: SourceAuth,
): Promise<OgcQueryables> {
  const base = stripTrailingSlash(baseUrl);
  const url = `${base}/collections/${encodeURIComponent(collection)}/queryables?f=schemajson`;
  return fetchJson<OgcQueryables>(url, auth);
}

/**
 * Fetch metadata for a single OGC API collection.
 * @throws {Error} If the request fails or the response status is not OK.
 */
export async function fetchCollectionDetail(
  baseUrl: string,
  collectionId: string,
  auth?: SourceAuth,
): Promise<OgcCollection> {
  const base = stripTrailingSlash(baseUrl);
  const url = `${base}/collections/${encodeURIComponent(collectionId)}?f=json`;
  return fetchJson<OgcCollection>(url, auth);
}

/**
 * Fetch the OGC API conformance declaration to discover server capabilities.
 * @throws {Error} If the request fails or the response status is not OK.
 */
export async function fetchConformance(baseUrl: string, auth?: SourceAuth): Promise<OgcConformance> {
  const url = `${stripTrailingSlash(baseUrl)}/conformance?f=json`;
  return fetchJson<OgcConformance>(url, auth);
}

/**
 * Fetch the TileJSON document for a collection's vector tiles.
 * @throws {Error} If the request fails or the response status is not OK.
 */
export async function fetchTileJson(
  baseUrl: string,
  collection: string,
  tileMatrixSetId: string = 'WebMercatorQuad',
  auth?: SourceAuth,
): Promise<TileJson> {
  const url = getTileJsonUrl(baseUrl, collection, tileMatrixSetId, auth);
  return fetchJson<TileJson>(url, auth);
}

/**
 * Fetch the total feature count for a collection (optionally filtered).
 * Uses limit=0 and reads `numberMatched` from the response.
 * Returns null if the server does not report numberMatched.
 * @throws {Error} If the request fails or the response status is not OK.
 */
export async function fetchFeatureCount(
  baseUrl: string,
  collection: string,
  options: Omit<FetchFeaturesOptions, 'limit' | 'offset' | 'properties'> = {},
  auth?: SourceAuth,
): Promise<number | null> {
  const data = await fetchFeatures(baseUrl, collection, {
    ...options,
    limit: 0,
  }, auth);
  return data.numberMatched ?? null;
}

/**
 * Build the TileJSON URL for a collection's vector tiles.
 */
export function getTileJsonUrl(
  baseUrl: string,
  collection: string,
  tileMatrixSetId: string = 'WebMercatorQuad',
  auth?: SourceAuth,
): string {
  const base = stripTrailingSlash(baseUrl);
  const url = `${base}/collections/${encodeURIComponent(collection)}/tiles/${encodeURIComponent(tileMatrixSetId)}/tilejson.json`;
  return appendAuth(url, auth);
}

/**
 * Strip a leading `schema.` qualifier from an OGC collection or MVT layer name.
 *
 * tipg serves vector tiles whose *internal* MVT layer name is the unqualified
 * table name (e.g. `road`), while the collection id and the TileJSON
 * `vector_layers[].id` are schema-qualified (`gunnison.road`). MapLibre's
 * `source-layer` must match the name *inside the tile*, so we strip the
 * qualifier from whichever name we feed it. Only the first `schema.` segment is
 * removed; names without a dot pass through unchanged (e.g. `default`).
 */
export function stripSchemaPrefix(name: string): string {
  return name.replace(/^[^.]+\./, '');
}

/**
 * Candidate TileJSON URLs for a collection. Different tipg deployments expose
 * the TileJSON under different paths — some at `…/tiles/{tms}/tilejson.json`,
 * others at `…/{tms}/tilejson.json` — so callers try each until one responds.
 * Returns raw URLs; auth is applied by the fetch layer.
 */
export function getTileJsonUrlCandidates(
  baseUrl: string,
  collection: string,
  tileMatrixSetId: string = 'WebMercatorQuad',
): string[] {
  const base = stripTrailingSlash(baseUrl);
  const c = encodeURIComponent(collection);
  const t = encodeURIComponent(tileMatrixSetId);
  return [
    `${base}/collections/${c}/tiles/${t}/tilejson.json`,
    `${base}/collections/${c}/${t}/tilejson.json`,
  ];
}

/**
 * Derive the MapLibre `source-layer` from a TileJSON document: the first
 * `vector_layers` entry's id, with any `schema.` qualifier stripped (see
 * {@link stripSchemaPrefix}). Returns null when no vector layer is declared.
 */
export function parseVectorSourceLayer(tileJson: TileJson): string | null {
  const id = tileJson.vector_layers?.[0]?.id;
  return id ? stripSchemaPrefix(id) : null;
}

const vectorSourceLayerCache = new Map<string, Promise<string | null>>();

/**
 * Resolve the MapLibre `source-layer` for a vector-tile collection by reading
 * the collection's TileJSON metadata, instead of assuming it equals the
 * unqualified collection name. This handles tipg deployments whose custom code
 * names the tile layer something other than the table (e.g. `default`).
 *
 * Returns the schema-stripped TileJSON `vector_layers` id, or `null` when no
 * TileJSON is reachable or it declares no vector layers — in which case the
 * caller should fall back to `stripSchemaPrefix(collection)`. Successful
 * resolutions are cached per base+collection+tileMatrixSet for the page
 * lifetime; `null` results are evicted so a transient TileJSON failure can be
 * retried on a later mount instead of pinning the layer to its fallback.
 */
export function fetchVectorSourceLayer(
  baseUrl: string,
  collection: string,
  tileMatrixSetId: string = 'WebMercatorQuad',
  auth?: SourceAuth,
): Promise<string | null> {
  const key = `${stripTrailingSlash(baseUrl)}|${collection}|${tileMatrixSetId}`;
  const cached = vectorSourceLayerCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    for (const url of getTileJsonUrlCandidates(baseUrl, collection, tileMatrixSetId)) {
      try {
        const tileJson = await fetchJson<TileJson>(url, auth);
        const sourceLayer = parseVectorSourceLayer(tileJson);
        if (sourceLayer) return sourceLayer;
      } catch {
        // Try the next candidate path.
      }
    }
    return null;
  })();
  // Cache the in-flight promise so concurrent layers share one request, but drop
  // it once resolved unless it yielded a name — keeps successes, retries misses.
  vectorSourceLayerCache.set(key, promise);
  void promise.then((resolved) => {
    if (!resolved) vectorSourceLayerCache.delete(key);
  });
  return promise;
}

/**
 * Build the vector tile URL template for a collection.
 * Returns a URL with `{z}/{x}/{y}` placeholders suitable for MapLibre.
 */
export function getVectorTileUrl(
  baseUrl: string,
  collection: string,
  tileMatrixSetId: string = 'WebMercatorQuad',
  auth?: SourceAuth,
): string {
  const base = stripTrailingSlash(baseUrl);
  const url = `${base}/collections/${encodeURIComponent(collection)}/tiles/${encodeURIComponent(tileMatrixSetId)}/{z}/{x}/{y}`;
  return appendAuth(url, auth);
}

/**
 * Build a vector tile URL template with optional property filters applied as query parameters.
 * Returns a URL with `{z}/{x}/{y}` placeholders suitable for MapLibre.
 */
export function getFilteredVectorTileUrl(
  baseUrl: string,
  collection: string,
  filter?: Record<string, string | number>,
  tileMatrixSetId: string = 'WebMercatorQuad',
  auth?: SourceAuth,
): string {
  let tileUrl = getVectorTileUrl(baseUrl, collection, tileMatrixSetId);
  if (filter && Object.keys(filter).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
      params.set(key, String(value));
    }
    tileUrl = `${tileUrl}?${params}`;
  }
  return appendAuth(tileUrl, auth);
}

/**
 * Fetch distinct non-null string values for a property in an OGC API collection.
 * Optionally filters by a substring query using a CQL2 `like` filter.
 * @throws {Error} If the request fails or the response status is not OK.
 */
async function paginateFeatures(
  baseUrl: string,
  collection: string,
  options: {
    properties?: string[];
    cql2Filter?: CQL2Expression;
    pageSize: number;
    maxFeatures: number;
  },
  onPage: (features: GeoJsonFeature[]) => void,
  auth?: SourceAuth,
  signal?: AbortSignal,
): Promise<void> {
  let offset = 0;
  let fetched = 0;
  while (fetched < options.maxFeatures) {
    const batchSize = Math.min(options.pageSize, options.maxFeatures - fetched);
    const page = await fetchFeatures(
      baseUrl,
      collection,
      {
        properties: options.properties,
        cql2Filter: options.cql2Filter,
        limit: batchSize,
        offset,
      },
      auth,
      signal,
    );
    onPage(page.features);
    fetched += page.features.length;
    offset += page.features.length;
    if (page.features.length < batchSize) return;
    if (page.numberMatched != null && offset >= page.numberMatched) return;
  }
}

export async function fetchDistinctValues(
  baseUrl: string,
  collection: string,
  property: string,
  options?: { query?: string; limit?: number; fetchAll?: boolean; maxFeatures?: number },
  auth?: SourceAuth,
  signal?: AbortSignal,
): Promise<string[]> {
  const cql2Filter: CQL2Expression | undefined =
    options?.query
      ? { op: 'like', args: [{ property }, `%${options.query}%`] }
      : undefined;

  const seen = new Set<string>();
  const collectValues = (features: GeoJsonFeature[]) => {
    for (const feature of features) {
      const val = feature.properties?.[property];
      if (val != null && typeof val === 'string') seen.add(val);
    }
  };

  if (options?.fetchAll) {
    await paginateFeatures(
      baseUrl,
      collection,
      {
        properties: [property],
        cql2Filter,
        pageSize: options.limit ?? 500,
        maxFeatures: options.maxFeatures ?? 10_000,
      },
      collectValues,
      auth,
      signal,
    );
  } else {
    const data = await fetchFeatures(baseUrl, collection, {
      properties: [property],
      limit: options?.limit ?? 50,
      cql2Filter,
    }, auth, signal);
    collectValues(data.features);
  }

  return Array.from(seen).sort();
}

/**
 * Fetch distinct non-null string values for multiple properties of a collection in a
 * single paginated walk. The per-property distinct sets are computed client-side; one
 * `fetchFeatures` page per request, with all requested properties returned together.
 *
 * Use this when prefetching several columns of the same collection (e.g. global search
 * configuring `ownername`, `parcelnumb`, `subdivisio` for a parcels layer) — it avoids
 * paginating the same features once per property.
 *
 * @throws {Error} If the request fails or the response status is not OK.
 */
export async function fetchDistinctValuesMulti(
  baseUrl: string,
  collection: string,
  properties: string[],
  options?: { pageSize?: number; maxFeatures?: number },
  auth?: SourceAuth,
  signal?: AbortSignal,
): Promise<Record<string, string[]>> {
  if (properties.length === 0) return {};

  const sets: Record<string, Set<string>> = {};
  for (const p of properties) sets[p] = new Set<string>();

  await paginateFeatures(
    baseUrl,
    collection,
    {
      properties,
      pageSize: options?.pageSize ?? 500,
      maxFeatures: options?.maxFeatures ?? 5000,
    },
    (features) => {
      for (const feature of features) {
        const props = feature.properties;
        if (!props) continue;
        for (const property of properties) {
          const v = props[property];
          if (v != null && typeof v === 'string') sets[property].add(v);
        }
      }
    },
    auth,
    signal,
  );

  const result: Record<string, string[]> = {};
  for (const p of properties) result[p] = Array.from(sets[p]).sort();
  return result;
}

/**
 * Build a vector tile URL template with a CQL2 JSON filter applied.
 * Returns a URL with `{z}/{x}/{y}` placeholders suitable for MapLibre.
 */
export function getCql2FilteredVectorTileUrl(
  baseUrl: string,
  collection: string,
  cql2Filter?: CQL2Expression | null,
  tileMatrixSetId: string = 'WebMercatorQuad',
  auth?: SourceAuth,
): string {
  let tileUrl = getVectorTileUrl(baseUrl, collection, tileMatrixSetId);
  if (cql2Filter) {
    const params = new URLSearchParams({
      'filter-lang': 'cql2-json',
      filter: JSON.stringify(cql2Filter),
    });
    tileUrl = `${tileUrl}?${params}`;
  }
  return appendAuth(tileUrl, auth);
}

/**
 * Build a stable source key for a vector tile layer, incorporating the CQL2 filter.
 * When the filter changes, the key changes, forcing MapLibre to re-fetch tiles.
 */
export function getVectorTileSourceKey(layerId: string, cql2Filter?: CQL2Expression | null): string {
  return cql2Filter ? `${layerId}--${JSON.stringify(cql2Filter)}` : layerId;
}

/**
 * Build a MapLibre geometry-type filter expression for restricting which
 * geometry types a layer renders.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGeometryFilter(types: string[]): any {
  return types.length === 1
    ? ['==', ['geometry-type'], types[0]]
    : ['in', ['geometry-type'], ['literal', types]];
}

/**
 * Build a raster imagery tile URL template for MapLibre.
 * If a custom tileUrlTemplate is provided, use it directly.
 * Otherwise, construct the OGC API Tiles standard pattern.
 */
export function getImageryTileUrl(
  baseUrl: string,
  collection: string,
  tileMatrixSetId: string = 'WebMercatorQuad',
  tileUrlTemplate?: string,
  auth?: SourceAuth,
): string {
  if (tileUrlTemplate) {
    // Skip appending auth if the URL already contains the auth param
    // (e.g. TileJSON tile URLs that bake in the API key)
    if (auth?.type === 'query_param' && new RegExp(`[?&]${auth.name}=`).test(tileUrlTemplate)) {
      return tileUrlTemplate;
    }
    return appendAuth(tileUrlTemplate, auth);
  }
  const base = stripTrailingSlash(baseUrl);
  const url = `${base}/collections/${encodeURIComponent(collection)}/map/tiles/${encodeURIComponent(tileMatrixSetId)}/{z}/{x}/{y}.png`;
  return appendAuth(url, auth);
}

/**
 * Fetch a TileJSON document from any URL (not OGC-specific).
 * Works with MapTiler, Mapbox, and any TileJSON-compliant endpoint.
 * @throws {Error} If the request fails or the response status is not OK.
 */
export async function fetchGenericTileJson(
  tileJsonUrl: string,
  auth?: SourceAuth,
): Promise<TileJson> {
  return fetchJson<TileJson>(tileJsonUrl, auth);
}

/**
 * Detect the type of a tile source URL.
 * Returns 'xyz' if it contains {z}/{x}/{y} placeholders,
 * 'tilejson' if URL likely points to a TileJSON document,
 * 'style' if the URL path ends in `style.json` (a MapLibre/Mapbox GL style document),
 * or 'ogc-api' otherwise.
 *
 * Note: a 'style' URL is NOT a valid imagery source — it describes a whole basemap
 * (multiple sources + layers). Callers should route style URLs to basemap handling
 * instead of the imagery inspector.
 */
export function detectTileSourceType(
  url: string,
): 'tilejson' | 'xyz' | 'style' | 'ogc-api' | 'wmts' {
  if (/\{z\}.*\{x\}.*\{y\}/i.test(url)) return 'xyz';
  if (/tilejson\.json|tiles\.json/i.test(url)) return 'tilejson';
  if (/\/style\.json(?:$|[?#])/i.test(url)) return 'style';
  if (/service=wmts/i.test(url)) return 'wmts';
  if (/wmtscapabilities\.xml/i.test(url)) return 'wmts';
  if (/\/wmts\//i.test(url) && /capabilities\.xml/i.test(url)) return 'wmts';
  return 'ogc-api';
}
