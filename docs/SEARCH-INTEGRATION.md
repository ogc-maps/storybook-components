# Search & Filter Integration Guide

End-to-end guide for wiring the SearchPanel component to OGC API data sources with CQL2 filtering, autocomplete, CSV export, and URL state sync.

---

## Architecture Overview

```
MapConfig.layers[].search.fields
        │
        ▼
┌──────────────────┐      onFilterChange       ┌──────────────────┐
│   SearchPanel    │ ──────────────────────────▶│  State (Zustand  │
│  (UI component)  │                            │   or useState)   │
│                  │◀──────────────────────────  │                  │
│  autocompleteSuggestions                      │  filters: Record │
└──────────────────┘                            │  <string,        │
        ▲                                       │   SearchFilter-  │
        │  onFetchSuggestions                   │   Values>        │
        ▼                                       └────────┬─────────┘
┌──────────────────┐                                     │
│ fetchDistinct-   │                      fromStructuredFilters()
│ Values (API)     │                                     │
└──────────────────┘                                     ▼
                                                ┌────────────────┐
                                                │ CQL2Expression │
                                                └───────┬────────┘
                                       ┌────────────────┼────────────────┐
                                       ▼                ▼                ▼
                              getCql2Filtered    useOgcFeatures     exportCsv
                              VectorTileUrl      (cql2Filter)       (cql2Filter)
                                       │                │                │
                                       ▼                ▼                ▼
                              Vector Tile Layer   GeoJSON Layer     CSV Download
```

---

## Step 1: Define Search Fields

Add a `search` config to each layer in your `MapConfig`:

```ts
import type { MapConfigInput } from '@ogc-maps/storybook-components/types';

const mapConfig: MapConfigInput = {
  // ... sources, basemaps, initialView ...
  layers: [
    {
      id: 'countries',
      sourceId: 'tipg-local',
      collection: 'public.ne_110m_admin_0_countries',
      label: 'Countries',
      visible: true,
      dataMode: 'vector-tiles',
      styles: [{ type: 'fill', paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.6 } }],
      search: {
        fields: [
          // Text with autocomplete
          {
            property: 'name',
            label: 'Country Name',
            type: 'text',
            placeholder: 'Search countries...',
            autocomplete: true,
          },
          // Select dropdown
          {
            property: 'continent',
            label: 'Continent',
            type: 'select',
            options: ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'],
          },
          // Number with slider + between operator
          {
            property: 'pop_est',
            label: 'Population',
            type: 'number',
            inputMode: 'slider',
            operator: 'between',
            min: 0,
            max: 1_500_000_000,
            step: 1_000_000,
          },
          // Datetime range
          {
            property: 'created_at',
            label: 'Created',
            type: 'datetime',
            range: true,
          },
        ],
      },
    },
  ],
};
```

See [CONFIGURATION.md](./CONFIGURATION.md#searchconfig) for the full SearchField reference.

---

## Step 2: Set Up State Management

### Option A: Zustand (recommended for apps)

```ts
import { create } from 'zustand';
import type { SearchFilterValues, SearchFilterValue } from '@ogc-maps/storybook-components/types';

interface FilterState {
  filters: Record<string, SearchFilterValues>;
  setFilter: (layerId: string, property: string, value: SearchFilterValue) => void;
  clearFilters: (layerId: string) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  filters: {},
  setFilter: (layerId, property, value) =>
    set((state) => ({
      filters: {
        ...state.filters,
        [layerId]: { ...state.filters[layerId], [property]: value },
      },
    })),
  clearFilters: (layerId) =>
    set((state) => ({ filters: { ...state.filters, [layerId]: {} } })),
}));
```

### Option B: useState (simpler apps)

```ts
const [filters, setFilters] = useState<Record<string, SearchFilterValues>>({});

const handleChange = (layerId: string, property: string, value: SearchFilterValue) =>
  setFilters((prev) => ({
    ...prev,
    [layerId]: { ...prev[layerId], [property]: value },
  }));

const handleClear = (layerId: string) =>
  setFilters((prev) => ({ ...prev, [layerId]: {} }));
```

---

## Step 3: Wire SearchPanel

```tsx
import { SearchPanel } from '@ogc-maps/storybook-components/components/SearchPanel';

<SearchPanel
  layers={mapConfig.layers}
  activeFilters={filters}
  onFilterChange={handleChange}
  onClearFilters={handleClear}
  autocompleteSuggestions={suggestions}
  onFetchSuggestions={handleFetchSuggestions}
  hideTitle={false}
/>
```

---

## Layer-level base filter (`layer.cql2Filter`)

A layer's saved `cql2Filter` (configured in the admin's CQL2 Filter editor) is a **permanent base filter** applied to *every* request for that layer — vector tile fetches, GeoJSON `useOgcFeatures` calls, and CSV exports all carry it. It applies on first map render and across reloads, even before the user ever opens the SearchPanel.

The SearchPanel's filter is then **AND-merged on top** of the base. So:

- **Base only** (no search active): every request carries `filter=<layer.cql2Filter>`.
- **Search active**: every request carries `filter=AND(<layer.cql2Filter>, <searchPanelDerived>)`.
- **Clearing the SearchPanel** does NOT remove the base — base-filtered features stay hidden. To see the unfiltered layer, edit the layer's `cql2Filter` in the admin.

Apps wire this via `mergeBaseAndActiveCql2Filters(layers, activeCql2Filters)` (exported from `@ogc-maps/storybook-components/utils`). The result is a `Record<layerId, CQL2Expression | undefined>` ready to drop into every consumer (`getCql2FilteredVectorTileUrl`, `getVectorTileSourceKey`, `fetchFeatures`, `useCsvExport`, etc.).

> **Gotcha — distinct values matter.** A base filter that doesn't match any feature will hide the entire layer, which often looks like a bug. The CQL2 editor surfaces a distinct-values dropdown for string properties to prevent typos like `"No"` vs `"NO"`.

---

## Step 4: Convert to CQL2

### Using `fromStructuredFilters` (recommended)

```ts
import { useMemo } from 'react';
import { fromStructuredFilters } from '@ogc-maps/storybook-components/hooks';

// For each layer that has search fields:
const layer = mapConfig.layers.find((l) => l.id === 'countries')!;
const cql2Filter = useMemo(
  () => fromStructuredFilters(filters[layer.id] ?? {}, layer.search?.fields ?? []),
  [filters, layer]
);
// cql2Filter is CQL2Expression | null
```

### Manual builder example

```ts
import { eq, between, and } from '@ogc-maps/storybook-components/hooks';

const cql2Filter = and(
  eq('continent', 'Europe'),
  between('pop_est', 1_000_000, 50_000_000)
);
```

---

## Step 5: Apply to Data

### Vector Tiles (key-remounting pattern)

MapLibre does **not** re-fetch tiles when the `tiles` URL prop changes on an existing Source. You **must** change both the React `key` and the Source/Layer `id` when the filter changes:

```tsx
import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { getCql2FilteredVectorTileUrl, serializeCql2 } from '@ogc-maps/storybook-components/hooks';

function FilteredVectorLayer({ layer, cql2Filter }) {
  const tileUrl = useMemo(
    () => getCql2FilteredVectorTileUrl(sourceUrl, layer.collection, cql2Filter),
    [sourceUrl, layer.collection, cql2Filter]
  );

  // Derive a stable key that changes when the filter changes
  const sourceKey = cql2Filter ? `${layer.id}-${serializeCql2(cql2Filter)}` : layer.id;

  return (
    <Source key={sourceKey} id={sourceKey} type="vector" tiles={[tileUrl]}>
      <Layer id={`${sourceKey}-fill`} type="fill" source-layer="default" paint={layer.style.paint} />
    </Source>
  );
}
```

### GeoJSON with useOgcFeatures

```tsx
import { useOgcFeatures } from '@ogc-maps/storybook-components/hooks';

const { features, loading } = useOgcFeatures(sourceUrl, layer.collection, {
  cql2Filter,
  limit: 1000,
});
```

---

## Step 6: Autocomplete

Wire `fetchDistinctValues` with debouncing to provide autocomplete suggestions:

```ts
import { useState, useCallback, useRef } from 'react';
import { fetchDistinctValues } from '@ogc-maps/storybook-components/hooks';

function useAutocompleteSuggestions(sources, layers) {
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleFetchSuggestions = useCallback(
    (layerId: string, property: string, query: string) => {
      const key = `${layerId}:${property}`;

      // Clear previous debounce timer
      if (timers.current[key]) clearTimeout(timers.current[key]);

      if (!query.trim()) {
        setSuggestions((prev) => ({ ...prev, [key]: [] }));
        return;
      }

      timers.current[key] = setTimeout(async () => {
        const layer = layers.find((l) => l.id === layerId);
        const source = sources.find((s) => s.id === layer?.sourceId);
        if (!source || !layer) return;

        const values = await fetchDistinctValues(source.url, layer.collection, property, {
          query,
          limit: 20,
        });
        setSuggestions((prev) => ({ ...prev, [key]: values }));
      }, 300);
    },
    [sources, layers]
  );

  return { suggestions, handleFetchSuggestions };
}
```

---

## Step 7: URL Sync

Persist filter state in the URL using [nuqs](https://nuqs.47ng.com/):

```ts
import { useQueryState, parseAsJson } from 'nuqs';
import type { SearchFilterValues } from '@ogc-maps/storybook-components/types';

const [urlFilters, setUrlFilters] = useQueryState(
  'filters',
  parseAsJson<Record<string, SearchFilterValues>>().withDefault({})
);

// Use urlFilters as your activeFilters, setUrlFilters in your handlers
const handleChange = (layerId: string, property: string, value: SearchFilterValue) =>
  setUrlFilters((prev) => ({
    ...prev,
    [layerId]: { ...prev[layerId], [property]: value },
  }));
```

---

## Step 8: CSV Export

Pass the CQL2 filter to `exportCsv` to export only filtered features:

```ts
import { useCsvExport } from '@ogc-maps/storybook-components/hooks';

const { exportCsv, loading } = useCsvExport({ baseUrl: sourceUrl });

// Export with the current filter applied
await exportCsv(layer.collection, `${layer.label}-filtered.csv`, cql2Filter ?? undefined);
```

---

## SearchFilterValue Reference

| Field Config | Value Shape | Example |
|---|---|---|
| `type: 'text'` | `string \| undefined` | `'France'` |
| `type: 'select'` | `string \| undefined` | `'Europe'` |
| `type: 'datetime'` | `string \| undefined` | `'2024-01-01T00:00'` |
| `type: 'datetime', range: true` | `{ start: string; end: string }` | `{ start: '2024-01-01T00:00', end: '2024-12-31T23:59' }` |
| `type: 'number', operator: 'eq'` (or gt/lt/gte/lte) | `{ value: number; operator: string }` | `{ value: 1000000, operator: 'gte' }` |
| `type: 'number', operator: 'between'` | `{ min: number; max: number }` | `{ min: 0, max: 50000000 }` |
| Any field cleared | `undefined` | `undefined` |

---

## Complete Working Example

A single component that wires SearchPanel, CQL2 filtering, autocomplete, and CSV export:

```tsx
import { useState, useMemo, useCallback, useRef } from 'react';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import { SearchPanel } from '@ogc-maps/storybook-components/components/SearchPanel';
import { ExportButton } from '@ogc-maps/storybook-components/components/ExportButton';
import {
  fromStructuredFilters,
  getCql2FilteredVectorTileUrl,
  serializeCql2,
  fetchDistinctValues,
  useCsvExport,
} from '@ogc-maps/storybook-components/hooks';
import type { SearchFilterValues, SearchFilterValue } from '@ogc-maps/storybook-components/types';
import { mapConfig } from './config/map-config';

const SOURCE_URL = 'http://localhost:8000';

export function FilteredMapApp() {
  // --- Filter state ---
  const [filters, setFilters] = useState<Record<string, SearchFilterValues>>({});
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleChange = useCallback((layerId: string, property: string, value: SearchFilterValue) => {
    setFilters((prev) => ({
      ...prev,
      [layerId]: { ...prev[layerId], [property]: value },
    }));
  }, []);

  const handleClear = useCallback((layerId: string) => {
    setFilters((prev) => ({ ...prev, [layerId]: {} }));
  }, []);

  // --- Autocomplete ---
  const handleFetchSuggestions = useCallback((layerId: string, property: string, query: string) => {
    const key = `${layerId}:${property}`;
    if (timers.current[key]) clearTimeout(timers.current[key]);
    if (!query.trim()) {
      setSuggestions((prev) => ({ ...prev, [key]: [] }));
      return;
    }
    timers.current[key] = setTimeout(async () => {
      const layer = mapConfig.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const values = await fetchDistinctValues(SOURCE_URL, layer.collection, property, { query, limit: 20 });
      setSuggestions((prev) => ({ ...prev, [key]: values }));
    }, 300);
  }, []);

  // --- CQL2 filter per layer ---
  const countriesLayer = mapConfig.layers.find((l) => l.id === 'countries')!;
  const cql2Filter = useMemo(
    () => fromStructuredFilters(filters[countriesLayer.id] ?? {}, countriesLayer.search?.fields ?? []),
    [filters, countriesLayer]
  );

  // --- Vector tile URL with key-remounting ---
  const tileUrl = useMemo(
    () => getCql2FilteredVectorTileUrl(SOURCE_URL, countriesLayer.collection, cql2Filter),
    [cql2Filter, countriesLayer.collection]
  );
  const sourceKey = cql2Filter ? `countries-${serializeCql2(cql2Filter)}` : 'countries';

  // --- CSV export ---
  const { exportCsv, loading: exporting } = useCsvExport({ baseUrl: SOURCE_URL });

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside style={{ width: 320, overflow: 'auto', padding: 16 }}>
        <SearchPanel
          layers={mapConfig.layers}
          activeFilters={filters}
          onFilterChange={handleChange}
          onClearFilters={handleClear}
          autocompleteSuggestions={suggestions}
          onFetchSuggestions={handleFetchSuggestions}
        />
        <ExportButton
          layers={[{ id: countriesLayer.id, label: countriesLayer.label, collection: countriesLayer.collection }]}
          onExport={(l) => exportCsv(l.collection, `${l.label}.csv`, cql2Filter ?? undefined)}
          loading={exporting}
        />
      </aside>

      <Map
        initialViewState={{ latitude: 0, longitude: 0, zoom: 2 }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        style={{ flex: 1 }}
      >
        <Source key={sourceKey} id={sourceKey} type="vector" tiles={[tileUrl]}>
          <Layer
            id={`${sourceKey}-fill`}
            type="fill"
            source-layer="default"
            paint={{ 'fill-color': '#4a90d9', 'fill-opacity': 0.6 }}
          />
        </Source>
      </Map>
    </div>
  );
}
```

---

## Troubleshooting

**Tiles don't update when filter changes**
You must change both the React `key` and the Source `id` when the filter changes. MapLibre ignores `tiles` prop updates on existing sources. See Step 5 for the key-remounting pattern.

**Autocomplete not showing suggestions**
1. Ensure the field has `autocomplete: true` in the search config.
2. Confirm `onFetchSuggestions` and `autocompleteSuggestions` are passed to `SearchPanel`.
3. Check the key format: suggestions must be keyed as `"layerId:property"`.

**`fromStructuredFilters` returns null**
This is expected when no filters are active (all values are `undefined` or empty strings). Always check for `null` before passing to `getCql2FilteredVectorTileUrl` or `useOgcFeatures`.

**Number slider not rendering**
Ensure `inputMode: 'slider'` is set on the field config, and that `min` and `max` are both provided. Without `min`/`max`, the slider has no range to render.

**Datetime range value shape mismatch**
When `range: true`, the value is `{ start: string; end: string }`, not a plain string. Always check `typeof value === 'object'` before accessing `.start` / `.end`.

**CSV export includes all features, not filtered ones**
Pass the `cql2Filter` as the third argument to `exportCsv()`:
```ts
exportCsv(layer.collection, 'export.csv', cql2Filter ?? undefined);
```
