import { useEffect, useRef, useState } from 'react';
import type { LayerConfig, AvailableProperty } from '@ogc-maps/storybook-components/types';
import { fetchQueryables, toAvailableProperties, isOgcApiSource } from '@ogc-maps/storybook-components/utils';
import { useMapStore } from '../stores/mapStore';

export function useLayerQueryables(layers: LayerConfig[]): Record<string, AvailableProperty[]> {
  const sources = useMapStore((s) => s.sources);
  const [cache, setCache] = useState<Record<string, AvailableProperty[]>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    for (const layer of layers) {
      if (requested.current.has(layer.id)) continue;
      const source = sources.find((s) => s.id === layer.sourceId);
      if (!source || !isOgcApiSource(source) || !source.url) continue;
      requested.current.add(layer.id);
      fetchQueryables(source.url, layer.collection, source.auth)
        .then((q) => {
          if (cancelled) return;
          setCache((prev) => ({ ...prev, [layer.id]: toAvailableProperties(q) }));
        })
        .catch(() => {
          if (cancelled) return;
          setCache((prev) => ({ ...prev, [layer.id]: [] }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [layers, sources]);

  return cache;
}
