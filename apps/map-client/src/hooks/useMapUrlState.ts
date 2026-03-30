import { z } from 'zod';
import {
  useQueryStates,
  parseAsFloat,
  parseAsString,
  parseAsArrayOf,
  parseAsJson,
} from 'nuqs';

// Viewport params: debounced, replace history
const viewportParsers = {
  lat: parseAsFloat,
  lng: parseAsFloat,
  zoom: parseAsFloat,
  pitch: parseAsFloat,
  bearing: parseAsFloat,
};

const searchFilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.object({ start: z.string(), end: z.string() }),
  z.object({ value: z.number(), operator: z.string() }),
  z.object({ min: z.number(), max: z.number() }),
]);

// Layer/basemap params: push history
const stateParsers = {
  layers: parseAsArrayOf(parseAsString),
  basemap: parseAsString,
  filters: parseAsJson(z.record(z.string(), z.record(z.string(), searchFilterValueSchema))),
};

export function useMapUrlState() {
  const [viewportState, setViewportState] = useQueryStates(viewportParsers, {
    history: 'replace',
    // Debounce viewport changes to avoid spamming history
    throttleMs: 300,
  });

  const [layerState, setLayerState] = useQueryStates(stateParsers, {
    history: 'push',
  });

  return {
    // Viewport
    viewportState,
    setViewportState,

    // Layers/basemap
    layerState,
    setLayerState,
  };
}
