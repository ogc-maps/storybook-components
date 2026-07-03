import { useState, useEffect } from 'react';
import { fetchQueryables, type OgcQueryables } from '../utils/ogcApi';

export interface UseOgcQueryablesResult {
  queryables: OgcQueryables | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch queryable properties for an OGC API collection.
 *
 * @param baseUrl - The base URL of the OGC API server
 * @param collectionId - The collection identifier
 */
export function useOgcQueryables(
  baseUrl: string | null,
  collectionId: string | null,
): UseOgcQueryablesResult {
  const [queryables, setQueryables] = useState<OgcQueryables | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!baseUrl || !collectionId) return;

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchQueryables(baseUrl, collectionId, undefined, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setQueryables(data);
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
  }, [baseUrl, collectionId]);

  return { queryables, loading, error };
}
