import { useState, useEffect } from 'react';
import {
  fetchFeatures,
  type OgcFeatureCollection,
  type GeoJsonFeature,
  type FetchFeaturesOptions,
  type SourceAuth,
} from '../utils/ogcApi';

export interface UseOgcFeaturesResult {
  features: GeoJsonFeature[];
  loading: boolean;
  error: Error | null;
  /** True when the server reports more features are available beyond the current page. */
  hasMore: boolean;
}

/**
 * Hook to fetch GeoJSON features from an OGC API collection.
 *
 * @param baseUrl    - The base URL of the OGC API server
 * @param collection - The collection ID to fetch features from
 * @param options    - Optional fetch parameters (bbox, limit, offset, properties, datetime)
 */
export function useOgcFeatures(
  baseUrl: string | null,
  collection: string | null,
  options: FetchFeaturesOptions = {},
  auth?: SourceAuth,
): UseOgcFeaturesResult {
  const [features, setFeatures] = useState<GeoJsonFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Serialize options for the dependency array to avoid re-fetching on every render
  const optionsKey = JSON.stringify(options);
  const authKey = auth ? `${auth.type}:${auth.name}:${auth.value}` : '';

  useEffect(() => {
    if (!baseUrl || !collection) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchFeatures(baseUrl, collection, options, auth)
      .then((data: OgcFeatureCollection) => {
        if (!cancelled) {
          setFeatures(data.features);

          // Determine if more results are available
          const limit = options.limit ?? 10;
          const offset = options.offset ?? 0;
          if (data.numberMatched != null) {
            setHasMore(offset + data.features.length < data.numberMatched);
          } else {
            // Heuristic: if we got exactly `limit` features, assume more exist
            setHasMore(data.features.length >= limit);
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setFeatures([]);
          setHasMore(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, collection, optionsKey, authKey]);

  return { features, loading, error, hasMore };
}
