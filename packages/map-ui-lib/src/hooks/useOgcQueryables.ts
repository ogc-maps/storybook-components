import { useState, useEffect } from 'react';
import { fetchQueryables, type OgcQueryables } from '../utils/ogcApi';
import type { SourceAuth } from '../utils/ogcApi';

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
 * @param auth - Optional authentication config for the source
 */
export function useOgcQueryables(
  baseUrl: string | null,
  collectionId: string | null,
  auth?: SourceAuth,
): UseOgcQueryablesResult {
  const [queryables, setQueryables] = useState<OgcQueryables | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const authKey = auth ? `${auth.type}:${auth.name}:${auth.value}` : '';

  useEffect(() => {
    if (!baseUrl || !collectionId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchQueryables(baseUrl, collectionId, auth)
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, collectionId, authKey]);

  return { queryables, loading, error };
}
