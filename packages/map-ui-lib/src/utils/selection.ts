/** Mode for selecting features on the map. */
export type SelectionMode = 'click' | 'box' | 'polygon';

/** A feature selected on the map. */
export interface SelectedFeature {
  id: string | number | undefined;
  layerId: string;
  properties: Record<string, unknown>;
  geometry: Record<string, unknown>;
}

/** Build a unique key for a selected feature for deduplication. */
export function selectedFeatureKey(feature: SelectedFeature): string {
  if (feature.id != null) return `${feature.layerId}:${feature.id}`;
  return `${feature.layerId}:${JSON.stringify(feature.properties)}`;
}

/** Maximum number of features that can be held in a selection. */
export const MAX_SELECTION = 1000;

/**
 * Merge `incoming` features into `existing`, skipping duplicates (by key) and capping at `max`.
 * Returns a new array; does not mutate either input.
 */
export function mergeUniqueFeatures(
  existing: SelectedFeature[],
  incoming: SelectedFeature[],
  max = MAX_SELECTION,
): SelectedFeature[] {
  const existingKeys = new Set(existing.map(selectedFeatureKey));
  const unique = incoming.filter((f) => !existingKeys.has(selectedFeatureKey(f)));
  const combined = [...existing, ...unique];
  return combined.length > max ? combined.slice(0, max) : combined;
}

/**
 * Build a GeoJSON FeatureCollection suitable for highlight rendering.
 * Returns `null` when the selection is empty so callers can gate source creation.
 */
export function buildHighlightFeatureCollection(
  features: SelectedFeature[],
): GeoJSON.FeatureCollection | null {
  if (features.length === 0) return null;
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature' as const,
      properties: f.properties,
      geometry: f.geometry as unknown as GeoJSON.Geometry,
    })),
  };
}
