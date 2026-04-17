import { useState, useEffect } from 'react';
import { fetchWmtsCapabilities, type WmtsCapabilities } from '../utils/wmts';
import type { SourceAuth } from '../types';

export interface UseWmtsCapabilitiesResult {
  capabilities: WmtsCapabilities | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Fetches and caches a WMTS GetCapabilities document.
 * Returns parsed layer metadata including available styles, tile matrix sets, and formats.
 */
export function useWmtsCapabilities(
  capabilitiesUrl: string | null,
  auth?: SourceAuth,
): UseWmtsCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<WmtsCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const authKey = auth ? `${auth.type}:${auth.name}:${auth.value}` : '';

  useEffect(() => {
    if (!capabilitiesUrl) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchWmtsCapabilities(capabilitiesUrl, auth)
      .then((data) => {
        if (!cancelled) setCapabilities(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilitiesUrl, authKey]);

  return { capabilities, loading, error };
}
