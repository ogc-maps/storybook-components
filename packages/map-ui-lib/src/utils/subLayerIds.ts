// Helpers for deriving the MapLibre Source / Layer ids a layer renders.
//
// These are the single source of truth for layer-id construction. Both the
// per-app renderers (`renderStyleLayers` / `renderPreviewStyleLayers`) and every
// consumer that looks layers up by id (interactiveLayerIds, paint sync,
// imperative reorder, selection filters) MUST go through them, so the id that is
// rendered can never drift from the id that is looked up.
import type { CQL2Expression } from './cql2';
import type { LineStyle, DashByCategory } from '../types';
import { getVectorTileSourceKey } from './ogcApi';
import { expandDashByCategory } from './dashByCategory';

/** Minimal structural shape of a style needed to derive its MapLibre ids. */
interface SubLayerIdStyle {
  type: string;
  dashByCategory?: DashByCategory;
}

/** Minimal structural shape of a layer needed to derive its MapLibre ids. */
interface SubLayerIdLayer {
  id: string;
  dataMode?: string;
  styles?: SubLayerIdStyle[];
}

/**
 * The MapLibre `Source` id for a layer. Vector-tile layers fold the CQL2 filter
 * into the key (so the source re-fetches when the filter changes); GeoJSON
 * layers just use the layer id.
 *
 * NOTE: this must NOT include the resolved MVT `source-layer` — that is folded
 * into the React remount *key* only, not the MapLibre id, so that the id stays
 * stable and matches the ids built by id-based consumers.
 */
export function getLayerSourceKey(layer: SubLayerIdLayer, cql2Filter?: CQL2Expression | null): string {
  return layer.dataMode === 'vector-tiles' ? getVectorTileSourceKey(layer.id, cql2Filter) : layer.id;
}

/** The MapLibre layer id for one style of a layer (before any dash expansion). */
export function getSubLayerId(sourceKey: string, styleType: string, styleIndex: number): string {
  return `${sourceKey}--${styleType}--${styleIndex}`;
}

/** The MapLibre layer id for one `dashByCategory` per-case sub-layer. */
export function getDashSubLayerId(baseSubLayerId: string, idSuffix: string): string {
  return `${baseSubLayerId}--${idSuffix}`;
}

/**
 * The MapLibre layer id(s) one style renders. Most styles map 1:1 to a single
 * id, but a `line` style with `dashByCategory` expands to one layer per case
 * (+ a default) — `${base}--dash--${slug}` — with NO base layer, exactly
 * mirroring the per-app renderers.
 */
export function getStyleSubLayerIds(sourceKey: string, style: SubLayerIdStyle, styleIndex: number): string[] {
  const baseId = getSubLayerId(sourceKey, style.type, styleIndex);
  if (style.type === 'line' && style.dashByCategory) {
    const expansions = expandDashByCategory(style as LineStyle);
    if (expansions.length > 0) {
      return expansions.map((sub) => getDashSubLayerId(baseId, sub.idSuffix));
    }
  }
  return [baseId];
}

/** All sub-layer ids a layer renders, in style order (dash styles expanded). */
export function getLayerSubLayerIds(layer: SubLayerIdLayer, cql2Filter?: CQL2Expression | null): string[] {
  const sourceKey = getLayerSourceKey(layer, cql2Filter);
  return (layer.styles ?? []).flatMap((s, i) => getStyleSubLayerIds(sourceKey, s, i));
}
