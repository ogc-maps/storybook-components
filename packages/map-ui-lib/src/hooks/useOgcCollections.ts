import { useState, useEffect } from 'react';
import { fetchCollections, type OgcCollection, type SourceAuth } from '../utils/ogcApi';

export interface UseOgcCollectionsResult {
  collections: OgcCollection[];
  loading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch the list of collections from an OGC API endpoint.
 *
 * @param baseUrl - The base URL of the OGC API server (e.g. "http://localhost:8000")
 * @param auth - Optional source authentication config
 */
export function useOgcCollections(baseUrl: string | null, auth?: SourceAuth): UseOgcCollectionsResult {
  const [collections, setCollections] = useState<OgcCollection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Serialize auth for stable dependency comparison
  const authKey = auth ? `${auth.type}:${auth.name}:${auth.value}` : '';

  useEffect(() => {
    if (!baseUrl) return;

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchCollections(baseUrl, auth, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setCollections(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, authKey]);

  return { collections, loading, error };
}
