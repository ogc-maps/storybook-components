import { useMemo, useRef } from 'react';
import type { MapSource } from '../types';
import {
  buildHeaderAuthTransformRequest,
  createLatestTransformRequest,
  type TransformRequestFn,
} from '../utils/sourceUrlMap';

/**
 * Returns a STABLE MapLibre `transformRequest` that injects header auth for the
 * given sources.
 *
 * react-map-gl v7 reads `transformRequest` only once, at map construction, and
 * never re-applies a changed value. Building the function reactively from
 * `sources` therefore loses header auth for any source that loads *after* the
 * map mounts (the common case — e.g. picking a header-auth WMTS imagery source
 * in the wizard, or an async config load). This hook's identity never changes,
 * so MapLibre captures it at construction, while the latest matcher is read
 * through a ref on every request — so late-arriving sources still get their
 * `Authorization` header on tile requests.
 */
export function useHeaderAuthTransformRequest(sources: MapSource[]): TransformRequestFn {
  const matcherRef = useRef<TransformRequestFn | undefined>(undefined);
  matcherRef.current = useMemo(() => buildHeaderAuthTransformRequest(sources), [sources]);
  return useMemo(() => createLatestTransformRequest(() => matcherRef.current), []);
}
