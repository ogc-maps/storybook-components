/** Mode for selecting features on the map. */
export type SelectionMode = 'click' | 'box' | 'polygon';

/** A feature selected on the map. */
export interface SelectedFeature {
  id: string | number | undefined;
  layerId: string;
  properties: Record<string, unknown>;
  geometry: Record<string, unknown>;
}

function stableSerialize(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

/** Build a unique key for a selected feature for deduplication. */
export function selectedFeatureKey(feature: SelectedFeature): string {
  if (feature.id != null) return `${feature.layerId}:${feature.id}`;
  return `${feature.layerId}:${stableSerialize(feature.properties)}`;
}
