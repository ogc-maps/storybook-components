import { useEffect, useState } from 'react';
import type { SourceAuth } from '../types';
import { stripSchemaPrefix, fetchVectorSourceLayer } from '../utils/ogcApi';

/**
 * Resolve the MapLibre `source-layer` for a vector-tile collection.
 *
 * Returns the schema-stripped collection name synchronously (correct for
 * standard tipg, so the layer renders immediately), then asynchronously upgrades
 * to the name declared in the collection's TileJSON when it differs — e.g. a
 * tipg instance whose custom code names the tile layer `default` instead of the
 * table. For tipg-standard sources the resolved value equals the fallback, so
 * the common case never triggers an extra render.
 *
 * Callers should fold the returned value into the source/layer React key (and
 * MapLibre id) so the source remounts with the corrected `source-layer` on the
 * rare occasion it changes.
 */
export function useVectorSourceLayer(
  baseUrl: string,
  collection: string,
  tileMatrixSetId: string = 'WebMercatorQuad',
  auth?: SourceAuth,
): string {
  const [sourceLayer, setSourceLayer] = useState(() => stripSchemaPrefix(collection));
  // Stable primitive so an unchanged auth object doesn't re-run the effect.
  const authKey = auth ? `${auth.type}:${auth.name}` : '';

  useEffect(() => {
    // Reset to the synchronous fallback when the target collection changes.
    setSourceLayer(stripSchemaPrefix(collection));
    let cancelled = false;
    fetchVectorSourceLayer(baseUrl, collection, tileMatrixSetId, auth)
      .then((resolved) => {
        if (!cancelled && resolved) setSourceLayer(resolved);
      })
      .catch(() => {
        /* keep the fallback */
      });
    return () => {
      cancelled = true;
    };
    // auth is captured via authKey; collection/baseUrl/tms cover the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, collection, tileMatrixSetId, authKey]);

  return sourceLayer;
}
