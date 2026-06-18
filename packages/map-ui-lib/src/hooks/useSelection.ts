import { useState, useMemo, useCallback } from 'react';
import type { SelectionMode, SelectedFeature } from '../utils/selection';
import {
  selectedFeatureKey,
  mergeUniqueFeatures,
  buildHighlightFeatureCollection,
} from '../utils/selection';

export interface UseSelectionResult {
  mode: SelectionMode | null;
  activeLayerId: string | null;
  features: SelectedFeature[];
  highlightData: GeoJSON.FeatureCollection | null;
  setMode: (mode: SelectionMode | null) => void;
  setActiveLayerId: (layerId: string | null) => void;
  addFeatures: (features: SelectedFeature[]) => void;
  removeFeature: (key: string) => void;
  clearFeatures: () => void;
}

export function useSelection(): UseSelectionResult {
  const [mode, setModeState] = useState<SelectionMode | null>(null);
  const [activeLayerId, setActiveLayerIdState] = useState<string | null>(null);
  const [features, setFeatures] = useState<SelectedFeature[]>([]);

  const highlightData = useMemo(() => buildHighlightFeatureCollection(features), [features]);

  const setMode = useCallback((newMode: SelectionMode | null) => {
    setModeState(newMode);
  }, []);

  const setActiveLayerId = useCallback((layerId: string | null) => {
    setActiveLayerIdState(layerId);
    setFeatures([]);
  }, []);

  const addFeatures = useCallback((newFeatures: SelectedFeature[]) => {
    setFeatures((prev) => mergeUniqueFeatures(prev, newFeatures));
  }, []);

  const removeFeature = useCallback((key: string) => {
    setFeatures((prev) => prev.filter((f) => selectedFeatureKey(f) !== key));
  }, []);

  const clearFeatures = useCallback(() => {
    setFeatures([]);
  }, []);

  return {
    mode,
    activeLayerId,
    features,
    highlightData,
    setMode,
    setActiveLayerId,
    addFeatures,
    removeFeature,
    clearFeatures,
  };
}
