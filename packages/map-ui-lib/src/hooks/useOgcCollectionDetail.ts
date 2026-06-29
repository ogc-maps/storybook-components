import { useState, useEffect } from 'react';
import { fetchCollectionDetail, type OgcCollection } from '../utils/ogcApi';
import type { SourceAuth } from '../utils/ogcApi';

export interface UseOgcCollectionDetailResult {
  collection: OgcCollection | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch metadata for a single OGC API collection.
 *
 * @param baseUrl - The base URL of the OGC API server
 * @param collectionId - The collection identifier
 * @param auth - Optional authentication config for the source
 */
export function useOgcCollectionDetail(
  baseUrl: string | null,
  collectionId: string | null,
  auth?: SourceAuth,
): UseOgcCollectionDetailResult {
  const [collection, setCollection] = useState<OgcCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const authKey = auth ? `${auth.type}:${auth.name}:${auth.value}` : '';

  useEffect(() => {
    if (!baseUrl || !collectionId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchCollectionDetail(baseUrl, collectionId, auth)
      .then((data) => {
        if (!cancelled) {
          setCollection(data);
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

  return { collection, loading, error };
}
