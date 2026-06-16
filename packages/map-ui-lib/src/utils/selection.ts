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
  // Sort keys so the key is stable regardless of property insertion order.
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(feature.properties).sort()) sorted[k] = feature.properties[k];
  return `${feature.layerId}:${JSON.stringify(sorted)}`;
}
