# Configuration Reference

The `MapConfig` object is the single source of truth for your map. It is defined as a Zod schema in `packages/map-ui-lib/src/schemas/config.ts` and all types are inferred from it.

## Import Paths

```ts
// Types only
import type { MapConfig, LayerConfig, ... } from '@ogc-maps/storybook-components/types';

// Schemas + validation utilities
import { MapConfigSchema, validateMapConfig, safeValidateMapConfig } from '@ogc-maps/storybook-components/schemas';
```

---

## MapConfig (root)

| Field | Type | Required | Description |
|---|---|---|---|
| `sources` | `OgcApiSource[]` | Yes (min 1) | OGC API data sources |
| `layers` | `LayerConfig[]` | Yes | Map layers (can be empty) |
| `basemaps` | `BasemapConfig[]` | Yes (min 1) | Background map styles |
| `sprites` | `SpriteSource[]` | No | Icon sprite definitions for symbol layers |
| `ui` | `UIConfig` | No (has defaults) | UI panel visibility flags |
| `info` | `InfoConfig` | No | "About this map" modal launched from a map control button |
| `initialView` | `ViewConfig` | Yes | Starting camera position |

---

## OgcApiSource

Describes an OGC API Features/Tiles server.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique identifier (referenced by `LayerConfig.sourceId`) |
| `url` | `string` (URL) | Yes | Base URL of the OGC API server |
| `label` | `string` | No | Human-readable name |
| `tileMatrixSetId` | `string` | No | Tile matrix set; default `"WebMercatorQuad"` |
| `type` | `"features" \| "imagery"` | No | Source type; default `"features"` |
| `auth` | `SourceAuth` | No | Authentication credentials (see below) |
| `proxy` | `boolean` | No | Route requests through the admin server to protect credentials and bypass CORS. See [PROXY.md](./PROXY.md) |

### SourceAuth

Credentials attached to requests for authenticated sources.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"query_param" \| "header"` | Yes | How the credential is sent |
| `name` | `string` | Yes | Query parameter name or HTTP header name |
| `value` | `string` | Yes | The credential value (e.g., API key) |

```ts
// Public source — no auth
{
  id: 'tipg-local',
  url: 'http://localhost:8000',
  label: 'Local tipg',
  tileMatrixSetId: 'WebMercatorQuad',
}

// Authenticated source with server-side proxy
{
  id: 'imagery-provider',
  url: 'https://tiles.example.com/api/v1',
  label: 'Aerial Imagery',
  type: 'imagery',
  auth: { type: 'query_param', name: 'access_token', value: 'sk_...' },
  proxy: true,
}
```

---

## LayerConfig

Defines a single map layer.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique identifier |
| `sourceId` | `string` | Yes | References an `OgcApiSource.id` |
| `collection` | `string` | Yes | OGC API collection name (e.g., `public.countries`) |
| `label` | `string` | Yes | Display name in UI |
| `visible` | `boolean` | No (default `true`) | Initial visibility |
| `dataMode` | `"vector-tiles" \| "geojson"` | Yes | How the layer fetches data |
| `style` | `StyleConfig` | No | Visual style (fill/line/circle/symbol) |
| `legend` | `LegendConfig` | No | Legend entries (auto-derived from style if omitted) |
| `filters` | `FilterConfig` | No | Initial/static filter state |
| `search` | `SearchConfig` | No | Search fields for the SearchPanel |

---

## StyleConfig

A discriminated union on `type`. The `paint` properties follow MapLibre GL JS conventions.

### Fill Style

```ts
{
  type: 'fill',
  paint: {
    'fill-color': '#4a90d9',     // default: '#000000'
    'fill-opacity': 0.6,          // default: 1, range: 0–1
    'fill-outline-color': '#2c5f8a', // optional
  }
}
```

| Paint Property | Type | Default | Description |
|---|---|---|---|
| `fill-color` | `string \| Expression` | `'#000000'` | Fill color (CSS color, hex, or data-driven expression) |
| `fill-opacity` | `number` (0–1) | `1` | Fill transparency |
| `fill-outline-color` | `string \| Expression` | — | Outline color (optional) |
| `fill-antialias` | `boolean` | — | Enable antialiasing |
| `fill-translate` | `[number, number]` | — | Pixel offset `[x, y]` |
| `fill-translate-anchor` | `"map" \| "viewport"` | — | Translation reference frame |
| `fill-pattern` | `string` | — | Image pattern name from sprite |

### Line Style

```ts
{
  type: 'line',
  paint: {
    'line-color': '#00bcd4',
    'line-width': 2,
    'line-opacity': 0.8,
    'line-dasharray': [2, 4], // optional
  }
}
```

| Paint Property | Type | Default | Description |
|---|---|---|---|
| `line-color` | `string \| Expression` | `'#000000'` | Line color |
| `line-width` | `number` (≥0) | `1` | Line width in pixels |
| `line-opacity` | `number` (0–1) | `1` | Line transparency |
| `line-dasharray` | `number[]` | — | Dash pattern (e.g., `[2, 4]`) |
| `line-translate` | `[number, number]` | — | Pixel offset `[x, y]` |
| `line-translate-anchor` | `"map" \| "viewport"` | — | Translation reference frame |
| `line-gap-width` | `number` (≥0) | — | Inner gap width in pixels |
| `line-offset` | `number` | — | Line offset (positive = left, negative = right) |
| `line-blur` | `number` (≥0) | — | Blur in pixels |
| `line-pattern` | `string` | — | Image pattern name from sprite |

| Layout Property | Type | Default | Description |
|---|---|---|---|
| `line-cap` | `"butt" \| "round" \| "square"` | — | Line cap style |
| `line-join` | `"bevel" \| "round" \| "miter"` | — | Line join style |
| `line-miter-limit` | `number` | — | Miter limit for miter joins |
| `line-round-limit` | `number` | — | Round limit for round joins |

#### Per-category line styling (`line-width`, `dashByCategory`)

Driving line *width* by a feature property is supported directly: `line-width`
has `dataDriven: true` in the property registry, so the StyleEditor exposes
its **categorical (`match`)** mode. Bind a property, list the cases, set a
fallback width — the saved expression is a standard MapLibre `["match", ...]`.

`line-dasharray` is the harder case. The MapLibre style spec **data-constants**
`line-dasharray` (and `line-pattern`), so a `["match", ["get", prop], …]`
expression is rejected at runtime. The project works around this with an
opt-in `dashByCategory` field on line styles:

```ts
{
  type: 'line',
  paint: { 'line-color': '#000', 'line-width': 1 },
  dashByCategory: {
    property: 'roadclass',
    cases: [
      { value: 'interstate', dasharray: [1, 0] },   // solid
      { value: 'primary',    dasharray: [4, 2] },
      { value: 'secondary',  dasharray: [2, 2] },
    ],
    default: [1, 4], // optional — features that match no case
  }
}
```

At render time the renderer ([`MapContainer.tsx`](../apps/map-client/src/components/MapContainer.tsx),
[`MapPreview.tsx`](../apps/admin-app/src/components/MapPreview.tsx)) calls
`expandDashByCategory()` and emits one MapLibre `<Layer>` per case (each with
a static `line-dasharray` and a filter `["==", ["get", property], value]`),
plus an optional default-case layer with the negated filter. Stable derived
ids (`${baseId}--line--${i}--dash--${slug}`) keep MapLibre layer reordering
correct.

The legend `Generate from styles` button picks up `dashByCategory` and
produces one entry per case — each with a dashed-line swatch faithfully
matching the rendered pattern.

### Circle Style

```ts
{
  type: 'circle',
  paint: {
    'circle-color': '#e74c3c',
    'circle-radius': 5,
    'circle-opacity': 0.9,
    'circle-stroke-color': '#ffffff', // optional
    'circle-stroke-width': 1,          // optional
  }
}
```

| Paint Property | Type | Default | Description |
|---|---|---|---|
| `circle-color` | `string \| Expression` | `'#000000'` | Circle fill color |
| `circle-radius` | `number` (≥0) | `5` | Radius in pixels |
| `circle-opacity` | `number` (0–1) | `1` | Circle transparency |
| `circle-stroke-color` | `string \| Expression` | — | Stroke color (optional) |
| `circle-stroke-width` | `number` (≥0) | — | Stroke width (optional) |
| `circle-stroke-opacity` | `number` (0–1) | — | Stroke opacity |
| `circle-blur` | `number` (≥0) | — | Blur in pixels |
| `circle-translate` | `[number, number]` | — | Pixel offset `[x, y]` |
| `circle-translate-anchor` | `"map" \| "viewport"` | — | Translation reference frame |
| `circle-pitch-scale` | `"map" \| "viewport"` | — | Scale relative to map or viewport |
| `circle-pitch-alignment` | `"map" \| "viewport"` | — | Alignment in pitched maps |

### Symbol Style

```ts
{
  type: 'symbol',
  paint: {
    'text-color': '#333333',
    'text-halo-color': '#ffffff',
    'text-halo-width': 1,
  },
  layout: {
    'text-field': '{name}',
    'text-size': 14,
    'text-anchor': 'top',
    // or for icon-based symbols:
    'icon-image': 'marker',
    'icon-size': 1.5,
  }
}
```

**Symbol Paint Properties:**

| Paint Property | Type | Default | Description |
|---|---|---|---|
| `icon-opacity` | `number` (0–1) | — | Icon opacity |
| `icon-color` | `string \| Expression` | — | Icon color (SDF icons only) |
| `icon-halo-color` | `string \| Expression` | — | Icon halo color |
| `icon-halo-width` | `number` (≥0) | — | Icon halo width in pixels |
| `icon-halo-blur` | `number` (≥0) | — | Icon halo blur in pixels |
| `icon-translate` | `[number, number]` | — | Icon pixel offset `[x, y]` |
| `icon-translate-anchor` | `"map" \| "viewport"` | — | Icon translation reference frame |
| `text-opacity` | `number` (0–1) | — | Text opacity |
| `text-color` | `string \| Expression` | — | Text color |
| `text-halo-color` | `string \| Expression` | — | Text halo color |
| `text-halo-width` | `number` (≥0) | — | Text halo width in pixels |
| `text-halo-blur` | `number` (≥0) | — | Text halo blur in pixels |
| `text-translate` | `[number, number]` | — | Text pixel offset `[x, y]` |
| `text-translate-anchor` | `"map" \| "viewport"` | — | Text translation reference frame |

**Symbol Layout Properties (selection):**

| Layout Property | Type | Description |
|---|---|---|
| `symbol-placement` | `"point" \| "line" \| "line-center"` | Symbol placement along geometry |
| `symbol-spacing` | `number` (≥1) | Spacing between repeated symbols |
| `symbol-avoid-edges` | `boolean` | Avoid tile edges when placing symbols |
| `symbol-sort-key` | `number` | Render order key |
| `icon-image` | `string` | Sprite image name |
| `icon-size` | `number` (≥0) | Icon scale factor |
| `icon-rotate` | `number` | Icon rotation in degrees |
| `icon-allow-overlap` | `boolean` | Allow overlapping icons |
| `icon-anchor` | `"center" \| "left" \| "right" \| "top" \| "bottom" \| ...` | Icon anchor position |
| `text-field` | `string` | Text content (use `{property}` placeholders) |
| `text-font` | `string[]` | Font stack (e.g., `["Open Sans Regular"]`) |
| `text-size` | `number` (≥0) | Text size in pixels |
| `text-max-width` | `number` (≥0) | Max line width in ems |
| `text-justify` | `"auto" \| "left" \| "center" \| "right"` | Text alignment |
| `text-anchor` | `"center" \| "left" \| "right" \| "top" \| "bottom" \| ...` | Text anchor position |
| `text-transform` | `"none" \| "uppercase" \| "lowercase"` | Text transform |
| `text-allow-overlap` | `boolean` | Allow overlapping text |

#### Labeling lines and polygons

Symbol styles aren't tied to point geometries. To label a line or polygon layer, add a second `StyleConfig` of `type: 'symbol'` to the same layer's `styles[]` (the LayerEditor exposes a **+ Add labels** button on line and polygon layers that have at least one string-typed queryable; it pre-fills `text-field` with the first string property).

- For **lines** (e.g. roads, trails), use `'symbol-placement': 'line'` so labels follow the line. MapLibre repeats labels along long lines based on `symbol-spacing`.
- For **polygons** (e.g. parcels, neighborhoods), use `'symbol-placement': 'point'` to place a single label near each polygon's centroid.

When a layer has mixed geometry types (e.g. a layer that returns both lines and polygons), set `geometryFilter` on the symbol style to scope it to one family — for example `['LineString', 'MultiLineString']` for a line-following label, or `['Polygon', 'MultiPolygon']` for a centroid label. Existing layers without symbol styles continue to render exactly as before; labels are opt-in.

```ts
// Roads with following-the-line labels
{
  styles: [
    { type: 'line', paint: { 'line-color': '#2980b9', 'line-width': 2 } },
    {
      type: 'symbol',
      paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1 },
      layout: { 'text-field': '{name}', 'text-size': 12, 'symbol-placement': 'line' },
    },
  ],
}
```

### Stacking order: layer order vs. Sort Key

Two different mechanisms control draw order, and they're easy to confuse:

- **Layer order (between layers).** The order of `layers[]` in the config — and the drag-reorder in the LayerPanel — controls which whole layer renders on top of which. To put roads above parcels, move the roads layer above parcels in the list.
- **Sort Key (within one layer).** Each style type has a `*-sort-key` property (`fill-sort-key`, `line-sort-key`, `circle-sort-key`, `symbol-sort-key`) that controls draw order **between features within the same layer**. Higher values draw on top.

Sort Key is most useful when toggled to **Data-driven**, which reads the value from a feature property (e.g. `["get", "priority"]`). That lets a single layer draw "priority 3" features above "priority 1" features without splitting into multiple layers. Setting Sort Key to a single static number applies that number to every feature, which only matters relative to other layers' sort keys when MapLibre interleaves them — usually not what you want.

For symbol layers, Sort Key also controls collision priority: higher-keyed labels win when two would overlap.

### Color editor: copy/paste + recents

Every color field in the admin UI — `StyleEditor` paint colors, `DataDrivenColorEditor` stops, `LegendEntryEditor` swatch + outline colors, `LegendEditor` panel background/text/border, basemap/branding colors — renders through a single `ColorPicker` primitive. That primitive ships with two productivity affordances driven by `useColorClipboard()`:

- **Copy / Paste icon buttons** next to the swatch. Copy stores the hex in a session-scoped module-level clipboard shared across every `ColorPicker` on the page. Paste pulls from that buffer. This is the primary channel; the OS clipboard (`navigator.clipboard.writeText`) is attempted on a best-effort basis but ignored on failure, so copy/paste works on plain HTTP where the browser clipboard API is gated.
- **Recent colors strip** under the picker. Every committed color is pushed onto a most-recent-first list, capped at 8, deduped, and persisted to `localStorage` under the key `mapui:recent-colors`. Clicking a swatch in the strip applies it. The list survives reload.

Two clicks (copy on layer A, paste on layer B) move a color between any two color-editing surfaces without re-typing the hex.

### Data-Driven Color Expressions

Color properties that accept `string | Expression` (marked above) support MapLibre expressions for data-driven styling. Expressions are passed as plain arrays validated by the schema.

**`match` expression** — categorical coloring:

```ts
'fill-color': ["match", ["get", "continent"],
  "Africa",        "#e8a838",
  "Asia",          "#d15b5b",
  "Europe",        "#5b8dd1",
  "North America", "#5bb85b",
  "#aaaaaa"  // fallback
]
```

**`interpolate` expression** — continuous/gradient coloring:

```ts
'fill-color': ["interpolate", ["linear"], ["get", "pop_est"],
  0,           "#ffffcc",
  500000000,   "#fd8d3c",
  1500000000,  "#800026"
]
```

Both expression types are recognized by the StyleEditor's "fx" toggle to build the visual categorical/gradient editors.

---

## LegendConfig

Explicit legend entries for a layer. If omitted and `style` is set, entries are auto-derived.

```ts
{
  entries: [
    { label: 'Countries', color: '#4a90d9', shape: 'square' },
    { label: 'Capitals',  color: '#e74c3c', shape: 'circle' },
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `entries` | `LegendEntry[]` | Yes (min 1) | List of legend items |
| `displayMode` | `"simple" \| "categorical" \| "gradient"` | No (default `"simple"`) | Legend display mode |
| `showLabelsCollapsed` | `boolean` | No | Show first/last entry labels when collapsed (categorical mode only) |
| `gradientProperty` | `string` | No | Property name shown above gradient stops when expanded (gradient mode only) |

**LegendEntry:**

| Field | Type | Required | Description |
|---|---|---|---|
| `label` | `string` | Yes | Display text |
| `color` | `string` | Yes | Swatch color (CSS color or hex) |
| `shape` | `"circle" \| "line" \| "square" \| "outline-square" \| "outline-circle"` | No | Swatch shape; defaults to `"square"`. The two `outline-*` shapes render with a transparent fill and a 1px border — useful for polygon styles configured with no fill (or full transparency) so the legend matches what you see on the map. |
| `outlineColor` | `string` | No | Border color for `outline-*` shapes. Falls back to `color` when omitted. |
| `outlineWidth` | `number` | No | Border width in pixels for `outline-*` shapes. Defaults to `1`. |

### Legend display (panel chrome)

The legend panel itself (background, text color, border) is configurable via `ui.legendDisplay`. All fields are optional; omit them to keep the default white background with slate text.

```ts
ui: {
  showLegend: true,
  legendDisplay: {
    background: '#0f172a',     // dark navy panel
    textColor: '#f1f5f9',      // light slate text
    borderColor: '#334155',    // subtle border
  },
}
```

| Field | Type | Description |
|---|---|---|
| `background` | `string` | CSS color for the legend panel background. Defaults to white. |
| `textColor` | `string` | CSS color for legend labels and headings. Defaults to slate-700. |
| `borderColor` | `string` | CSS color for the legend panel border. Omit to draw no border. |

The LegendEditor in the admin app exposes these fields under the **Legend Display** section of the **UI** wizard step.

---

## SearchConfig

Configures the search/filter fields shown in `SearchPanel` for a layer.

```ts
{
  fields: [
    // Text with autocomplete (fetches suggestions from API)
    { property: 'name', label: 'Name', type: 'text', placeholder: 'Search...', autocomplete: true },

    // Text with static suggestions (no API call)
    { property: 'code', label: 'Code', type: 'text', options: ['US', 'DE', 'FR'] },

    // Select dropdown (static options required)
    { property: 'continent', label: 'Continent', type: 'select', options: ['Africa', 'Asia', 'Europe'] },

    // Number with slider and between operator
    { property: 'pop', label: 'Population', type: 'number', inputMode: 'slider', operator: 'between', min: 0, max: 1_500_000_000, step: 1_000_000 },

    // Number with default input mode and comparison operator
    { property: 'area', label: 'Area (km²)', type: 'number', operator: 'gte' },

    // Datetime range (start + end pickers)
    { property: 'created_at', label: 'Created', type: 'datetime', range: true },

    // Datetime single value
    { property: 'updated_at', label: 'Updated After', type: 'datetime' },
  ]
}
```

**SearchField** is a discriminated union on `type`. All field types share these base fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `property` | `string` | Yes | OGC API property name |
| `label` | `string` | Yes | Display label |
| `type` | `"text" \| "number" \| "select" \| "datetime"` | Yes | Discriminator — determines available options |
| `placeholder` | `string` | No | Input placeholder text |

### TextSearchField (`type: 'text'`)

| Field | Type | Default | Description |
|---|---|---|---|
| `autocomplete` | `boolean` | `false` | Enable autocomplete — triggers `onFetchSuggestions` callback on the `SearchPanel` |
| `options` | `string[]` | — | Static suggestion list (merged with API suggestions when `autocomplete` is also `true`) |

### NumberSearchField (`type: 'number'`)

| Field | Type | Default | Description |
|---|---|---|---|
| `inputMode` | `"input" \| "slider"` | `"input"` | Render a text input or a range slider |
| `operator` | `"eq" \| "gt" \| "lt" \| "gte" \| "lte" \| "between"` | `"eq"` | Comparison operator. `"between"` shows min/max inputs (or a dual-thumb slider) |
| `min` | `number` | — | Minimum value (required for `slider` input mode) |
| `max` | `number` | — | Maximum value (required for `slider` input mode) |
| `step` | `number` | — | Step increment for the slider or number input |

### DatetimeSearchField (`type: 'datetime'`)

| Field | Type | Default | Description |
|---|---|---|---|
| `range` | `boolean` | `false` | When `true`, renders start + end datetime pickers. Value shape becomes `{ start: string; end: string }` |

### SelectSearchField (`type: 'select'`)

| Field | Type | Required | Description |
|---|---|---|---|
| `options` | `string[]` | Yes | Static list of dropdown options |

---

## FilterConfig

Initial or static filter state for a layer (separate from SearchPanel runtime filters).

```ts
{
  properties: { continent: 'Asia', active: true },
  bbox: [-10, 35, 40, 70],    // [minLng, minLat, maxLng, maxLat]
  datetime: '2024-01-01T00:00:00Z',
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `properties` | `Record<string, string \| number \| boolean \| string[]>` | No | Property filters |
| `bbox` | `[number, number, number, number]` | No | Bounding box filter |
| `datetime` | `string` | No | Datetime filter (ISO 8601) |

---

## BasemapConfig

A background map style.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique identifier |
| `label` | `string` | Yes | Display name |
| `url` | `string` (URL) | Yes | MapLibre style JSON URL |
| `thumbnail` | `string` (URL) | No | Preview image URL |

```ts
{
  id: 'carto-positron',
  label: 'CARTO Positron',
  url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  thumbnail: 'https://example.com/positron-thumb.png',
}
```

---

## SpriteSource

An icon sprite definition used by symbol layers.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique identifier |
| `url` | `string` (URL) | Yes | Base URL of the sprite sheet (without `.json`/`.png` extension) |

```ts
{ id: 'my-icons', url: 'https://example.com/sprites/icons' }
```

---

## UIConfig

Controls which UI panels are visible. All fields default to shown, except `showSearchPanel`.

| Field | Type | Default | Description |
|---|---|---|---|
| `showLayerPanel` | `boolean` | `true` | Show/hide `LayerPanel` |
| `showLegend` | `boolean` | `true` | Show/hide `Legend` |
| `showBasemapSwitcher` | `boolean` | `true` | Show/hide `BasemapSwitcher` |
| `showSearchPanel` | `boolean` | `false` | Show/hide `SearchPanel` |
| `showCoordinateDisplay` | `boolean` | `true` | Show/hide `CoordinateDisplay` |
| `showFeatureDetail` | `boolean` | `true` | Show/hide `FeatureDetailPanel` |
| `showFeatureTooltip` | `boolean` | `true` | Show/hide `FeatureTooltip` |
| `showExportButton` | `boolean` | `true` | Show/hide `ExportButton` |
| `showLegendOpacity` | `boolean` | `false` | Show per-layer opacity sliders in `Legend` (requires `onOpacityChange` prop) |
| `showScaleBar` | `boolean` | `false` | Show/hide the `ScaleBarControl` at the bottom-left of the map |
| `legendOrder` | `string[]` | _(unset)_ | Optional explicit display order for legend layers (array of layer IDs). Unlisted legend-bearing layers follow in natural order |
| `coordinateFormat` | `"decimal-degrees" \| "ddm" \| "dms"` | `"decimal-degrees"` | Default format for the cursor coordinate readout (decimal degrees, degree decimal minutes, or degrees-minutes-seconds) |

---

## InfoConfig

Attaches an "About this map" modal to the map, launched by an info-icon control button. Omit the section (or set `enabled: false`) to hide the button entirely — existing configs remain backwards compatible.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `enabled` | `boolean` | No | `false` | When `false`, no button is rendered |
| `title` | `string` | No | `"About this map"` | Modal heading |
| `markdown` | `string` | No | `""` | Body content, rendered with `react-markdown` + GFM |
| `position` | `"top-right" \| "top-left" \| "bottom-right" \| "bottom-left"` | No | `"top-right"` | Corner the control button is anchored to |

**Markdown rendering:**

- GitHub Flavored Markdown is supported — tables, task lists, strikethrough, and autolinks all work.
- Links open in a new tab automatically (`target="_blank"` with safe `rel` attributes).

**Positioning:**

- `"top-right"` places the button in the reorderable top-right control stack; its order relative to other top-right controls can be adjusted via the UI Config editor's `controlOrder`.
- `"top-left"`, `"bottom-right"`, and `"bottom-left"` render the button as a standalone overlay anchored to that corner.

```json
{
  "info": {
    "enabled": true,
    "title": "About this map",
    "position": "top-right",
    "markdown": "# Methodology\n\nThis map shows...\n\n- Layer A is sourced from...\n- Layer B is...\n\n[Full methodology PDF](https://example.com/methods.pdf)\n\n## Coordinate system\n\nEPSG:4326"
  }
}
```

---

## ViewConfig

Initial camera position for the map.

| Field | Type | Required | Range | Description |
|---|---|---|---|---|
| `latitude` | `number` | Yes | -90 to 90 | Center latitude |
| `longitude` | `number` | Yes | -180 to 180 | Center longitude |
| `zoom` | `number` | Yes | 0 to 24 | Zoom level |
| `pitch` | `number` | No (default `0`) | 0 to 85 | Tilt angle in degrees |
| `bearing` | `number` | No (default `0`) | -180 to 180 | Rotation in degrees |

---

## Validation

### `validateMapConfig(config: unknown): MapConfig`

Parses and validates a config, throwing a `ZodError` if invalid.

```ts
import { validateMapConfig } from '@ogc-maps/storybook-components/schemas';

try {
  const config = validateMapConfig(rawConfig);
  // config is fully typed as MapConfig
} catch (err) {
  // err is a ZodError with detailed issue list
}
```

### `safeValidateMapConfig(config: unknown): SafeParseReturnType<MapConfig>`

Returns a result object instead of throwing.

```ts
import { safeValidateMapConfig } from '@ogc-maps/storybook-components/schemas';

const result = safeValidateMapConfig(rawConfig);

if (result.success) {
  console.log(result.data); // MapConfig
} else {
  console.error(result.error.issues); // ZodIssue[]
}
```

---

## Full Example

Based on the reference app (`apps/map-client/src/config/map-config.ts`):

```ts
import type { MapConfigInput } from '@ogc-maps/storybook-components/types';

export const mapConfig: MapConfigInput = {
  sources: [
    {
      id: 'tipg-local',
      url: 'http://localhost:8000',
      label: 'Local tipg (Natural Earth)',
      tileMatrixSetId: 'WebMercatorQuad',
    },
  ],
  layers: [
    {
      id: 'countries',
      sourceId: 'tipg-local',
      collection: 'public.ne_110m_admin_0_countries',
      label: 'Countries',
      visible: true,
      dataMode: 'vector-tiles',
      styles: [
        {
          type: 'fill',
          paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.6, 'fill-outline-color': '#2c5f8a' },
        },
      ],
      legend: {
        entries: [{ label: 'Countries', color: '#4a90d9', shape: 'square' }],
      },
      search: {
        fields: [
          { property: 'name',       label: 'Country Name', type: 'text',     placeholder: 'Enter country name...', autocomplete: true },
          { property: 'continent',  label: 'Continent',    type: 'select',   options: ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'] },
          { property: 'pop_est',    label: 'Population',   type: 'number',   inputMode: 'slider', operator: 'between', min: 0, max: 1_500_000_000, step: 1_000_000 },
          { property: 'created_at', label: 'Created At',   type: 'datetime', range: true },
        ],
      },
    },
    {
      id: 'cities',
      sourceId: 'tipg-local',
      collection: 'public.ne_110m_populated_places',
      label: 'Cities',
      visible: true,
      dataMode: 'geojson',
      styles: [
        {
          type: 'circle',
          paint: { 'circle-color': '#e74c3c', 'circle-radius': 5, 'circle-opacity': 0.9, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
        },
      ],
      legend: {
        entries: [{ label: 'Cities', color: '#e74c3c', shape: 'circle' }],
      },
    },
    {
      id: 'rivers',
      sourceId: 'tipg-local',
      collection: 'public.ne_110m_rivers_lake_centerlines',
      label: 'Rivers',
      visible: true,
      dataMode: 'vector-tiles',
      styles: [
        {
          type: 'line',
          paint: { 'line-color': '#00bcd4', 'line-width': 2, 'line-opacity': 0.8 },
        },
      ],
      legend: {
        entries: [{ label: 'Rivers', color: '#00bcd4', shape: 'line' }],
      },
    },
  ],
  basemaps: [
    { id: 'carto-positron',    label: 'CARTO Positron',    url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' },
    { id: 'carto-dark-matter', label: 'CARTO Dark Matter', url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
  ],
  ui: {
    showLayerPanel: true,
    showLegend: true,
    showBasemapSwitcher: true,
    showSearchPanel: true,
    showCoordinateDisplay: true,
    showFeatureDetail: true,
    showFeatureTooltip: true,
    showExportButton: true,
  },
  initialView: { latitude: 0, longitude: 0, zoom: 2, pitch: 0, bearing: 0 },
};
```
