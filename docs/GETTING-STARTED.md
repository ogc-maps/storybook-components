# Getting Started

This guide walks you through installing `@ogc-maps/storybook-components`, defining a minimal config, and rendering your first components.

## Installation

```bash
pnpm add @ogc-maps/storybook-components
# or
npm install @ogc-maps/storybook-components
# or
yarn add @ogc-maps/storybook-components
```

**Peer dependencies** (install separately if not already present):

```bash
pnpm add react react-dom react-icons
```

## Import Styles

Import the library's compiled CSS in your app entry point (e.g., `main.tsx`):

```tsx
import '@ogc-maps/storybook-components/style.css';
```

The library uses TailwindCSS v4 with a `mapui:` prefix — all styles are scoped and self-contained.

## Define a Minimal Config

Create a config object that satisfies `MapConfig`. At minimum you need one source, one basemap, and an `initialView`:

```ts
import type { MapConfigInput } from '@ogc-maps/storybook-components/types';

export const mapConfig: MapConfigInput = {
  sources: [
    {
      id: 'my-api',
      url: 'https://my-ogc-api.example.com',
      label: 'My OGC API',
    },
  ],
  layers: [
    {
      id: 'countries',
      sourceId: 'my-api',
      collection: 'public.countries',
      label: 'Countries',
      visible: true,
      dataMode: 'vector-tiles',
      styles: [
        {
          type: 'fill',
          paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.6 },
        },
      ],
    },
  ],
  basemaps: [
    {
      id: 'carto-positron',
      label: 'CARTO Positron',
      url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    },
  ],
  initialView: {
    latitude: 0,
    longitude: 0,
    zoom: 2,
  },
};
```

> `MapConfigInput` is the pre-validation shape — fields with schema defaults (like `ui` or `initialView.pitch`/`bearing`) are optional here. Run it through `validateMapConfig`/`safeValidateMapConfig` (below) to get a fully-defaulted `MapConfig`.

## Validate the Config

Use `safeValidateMapConfig` to validate without throwing:

```ts
import { safeValidateMapConfig } from '@ogc-maps/storybook-components/schemas';

const result = safeValidateMapConfig(mapConfig);

if (!result.success) {
  console.error('Invalid config:', result.error.issues);
} else {
  const validConfig = result.data; // fully typed MapConfig
}
```

Or use `validateMapConfig` if you prefer exceptions:

```ts
import { validateMapConfig } from '@ogc-maps/storybook-components/schemas';

const validConfig = validateMapConfig(mapConfig); // throws ZodError if invalid
```

## Render Components

All components are fully controlled — you manage state and pass it down via props.

### LayerPanel + Legend

```tsx
import { useState } from 'react';
import { LayerPanel } from '@ogc-maps/storybook-components/components/LayerPanel';
import { Legend } from '@ogc-maps/storybook-components/components/Legend';
import { mapConfig } from './mapConfig';

function MapUI() {
  const [visibleLayerIds, setVisibleLayerIds] = useState<string[]>(
    mapConfig.layers.filter((l) => l.visible).map((l) => l.id)
  );

  const handleToggle = (layerId: string) => {
    setVisibleLayerIds((prev) =>
      prev.includes(layerId) ? prev.filter((id) => id !== layerId) : [...prev, layerId]
    );
  };

  return (
    <div style={{ position: 'absolute', top: 16, right: 16 }}>
      <LayerPanel
        layers={mapConfig.layers}
        activeLayerIds={visibleLayerIds}
        onToggleVisibility={handleToggle}
      />
      <Legend layers={mapConfig.layers} visibleLayerIds={visibleLayerIds} />
    </div>
  );
}
```

## Next Steps

- **[CONFIGURATION.md](./CONFIGURATION.md)** — Full `MapConfig` schema reference
- **[COMPONENTS.md](./COMPONENTS.md)** — All component APIs
- **[HOOKS.md](./HOOKS.md)** — OGC API hooks and utility functions
- **[PUBLISHING.md](./PUBLISHING.md)** — Publishing and versioning guide
