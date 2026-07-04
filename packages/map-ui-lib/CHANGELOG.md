# @ogc-maps/storybook-components

## 0.17.0

### Minor Changes

- a1366e9: Add map-agnostic data-editing primitives for the "my data" row CRUD feature:

  - **`GeometryEditor`** — a fully controlled, framework-agnostic geometry editor with Draw / WKT / Coordinates tabs. The Draw tab renders an app-injected `mapSlot` (the library never imports a map); the WKT tab is a textarea backed by the new parser; the Coordinates tab is a structured `[lng, lat]` list editor for simple Point/LineString/Polygon geometries and steers users to WKT/Draw for complex types.
  - **`AttributeForm`** — a controlled attribute editor that renders one input per column, choosing the input type (number / boolean / date / datetime / text) from the column's Postgres data type. Also exports `attributeInputKind`.
  - **`wktToGeojsonGeometry`** — reverse of `geojsonGeometryToWkt`. Parses Point, MultiPoint (both member forms), LineString, MultiLineString, Polygon, MultiPolygon and nested GeometryCollection; case-insensitive, whitespace-tolerant, `EMPTY`-aware; returns `null` on any failure (never throws). `wkt.ts` is now exported from the utils barrel.
  - **geometry utils** (`isValidGeometry`, `geometryToCoordinateList`, `coordinateListToGeometry`) — pure helpers for structural validation (with lng/lat bounds and closed-ring checks) and converting between simple geometries and flat coordinate lists.

- f39093b: Legend: improve outline swatches. `outline-square` and `outline-circle` now render via SVG with sharp 90° corners on the square and a slightly larger 14px footprint so the two shapes are easier to tell apart. The existing `dasharray` field on `LegendEntry` is now honored for outline shapes too, producing a dashed border (previously dashed-only worked for the `line` shape). No schema or API change.
- d4e7e6c: LayerEditor/LayerList: add an optional `availableSourceGroups` prop so the source
  picker can group choices (e.g. "My Data" vs "External Sources") with `<optgroup>`
  headers. Backward-compatible — omitting it preserves the existing flat list. Also
  exports the new `buildSourceOptionGroups` helper and `SourceGroup`/
  `SourceOptionGroup` types.
- 14f9314: LayerList: optional controlled draft-layer props (`draftLayer`, `onDraftChange`) so consumers can render the in-progress new-layer in a live preview before "Save Layer" is clicked. Backwards-compatible — when both props are omitted, the existing internal-state behavior is preserved.

### Patch Changes

- 4aa4aef: Harden export converters against real-world data (found via export→import round-trip QA):

  - **Null geometry no longer breaks KML / Shapefile / FlatGeobuf / GeoPackage exports.** KML, Shapefile, and FlatGeobuf serializers dereferenced `geometry.type` and threw on null; GeoPackage didn't crash but wrote null-geometry rows as empty point geometries (forcing the table to MULTIPOINT and round-tripping the wrong feature count). All four spatial/binary formats now skip null-geometry features before serializing, so they agree on feature count. CSV and GeoJSON keep tolerating nulls (text formats can legitimately carry them). Shapefile still errors when _every_ feature lacks geometry.
  - **Shapefile `.shx` is no longer corrupt for line layers.** `@mapbox/shp-write` collapsed all polyline features into a single multi-part record (`.shx` had 1 index entry for N features) while the `.dbf` kept N rows, so GDAL rejected the file with "Inconsistent record number in .shx (1) and .dbf (N)". Fixed via a `pnpm` patch to shp-write so each line feature gets its own record, and the line layer now uses the collection id as its filename instead of the `POLYLINE` fallback.
  - **FlatGeobuf exports now embed CRS metadata (EPSG:4326).** Previously importers logged "no CRS found — assumed EPSG:4326"; the CRS84/EPSG:4326 code is now written into the FGB header.

## 0.16.0

### Minor Changes

- 8471753: Phase 2 UI additions:

  - Add `ScaleBarControl` component with Web Mercator `metersPerPixel`,
    `computeMetricScale`, and `computeImperialScale` helpers.
  - Extend `UIConfig` with `showScaleBar`, `legendOrder`, and
    `coordinateFormat` (`decimal-degrees` | `ddm` | `dms`).
  - `Legend` accepts a `legendOrder` prop for explicit layer ordering.
  - `CoordinateDisplay` exports `formatDDM` and defaults now include DDM.
  - `UIConfigEditor` gains a Legend Order reorder UI and a Coordinate
    Format dropdown (gated on `showCoordinateDisplay`).

- 55ba21d: Phase 3 — export selected + interactive results table:

  - `ExportModal` gains a "Source" toggle between "All (filtered)" and
    "Selected only" when `selectionCount > 0`. New props `selectionCount`
    and `selectionLayerId` lock the layer picker to the selection layer
    while in "Selected only" mode. `ExportRequest` gains a `mode:
'all' | 'selected'` field so consumers can route selected exports to
    the new `useExport().exportFeatures(...)` entry point and skip the
    API fetch.
  - `useExport` returns a new `exportFeatures(features, collectionId,
formatId, filename)` function that converts an in-memory feature
    array directly to the requested format.
  - `ResultsDrawer` becomes interactive: hide/show columns via a column
    picker, reorder columns with per-header arrow buttons, and cycle
    ascending/descending/none sorting on any column. All three are
    controlled via new optional props (`columnOrder`,
    `onColumnOrderChange`, `hiddenColumns`, `onHiddenColumnsChange`,
    `sortBy`, `onSortChange`) and fall back to internal state when
    uncontrolled. New `ResultsDrawerSort` / `SortDirection` exports.

- c5fd64a: Phase 3 geo + coordinate additions (Chunks 3B, 3C):

  - `utils/geo.ts` exports a new `zoomToFeature(geometry, options)` helper that
    returns a `ZoomToFeatureInstruction` — either `fitBounds` (for polygon/line
    geometries, with a `maxZoom` cap so small polygons don't snap to max zoom) or
    `flyTo` (for point/zero-area geometries, respecting layer `minZoom`/`maxZoom`
    and an optional `pointZoom` preference). Exported constants:
    `DEFAULT_POINT_ZOOM`, `DEFAULT_POLYGON_MAX_ZOOM`.
  - `LayerConfigSchema` accepts an optional `zoomToLevel` override used as the
    preferred zoom when fitting to point features.
  - `CoordinateDisplay` gains `onNavigate`, `isExpanded`, and `onToggleExpand`
    props. When `onNavigate` is provided, clicking the readout expands an inline
    lat/lng input form that accepts decimal degrees, DDM, or DMS (with optional
    N/S/E/W) via the newly exported `parseCoordinate` helper.

- 81d6d62: Phase 4 — color themes, expanded search, PDF export, and imagery thumbnails:

  - **Color themes for StyleEditor**: `StyleEditor` accepts optional
    `themes` (an array of named color palettes) and exposes a theme picker
    that fills in stroke/fill colors from the chosen palette in one click.
  - **Expanded SearchPanel**: `SearchPanel` gains optional `expandable`,
    `expanded`, and `onExpandedChange` props. When expanded, the panel
    renders inside a centered modal and shows a new `AllFiltersBuilder`
    section for ad-hoc per-layer `FilterRule` construction. New optional
    props: `availableProperties`, `customRules`, `onCustomRulesChange`.
  - **PdfExportDialog**: new library component — a form-only modal for
    title, filename, and include-toggles (legend / scale bar / north
    arrow). Library stays framework-agnostic; jsPDF/html2canvas rendering
    is left to the consuming app. Gated in the client via the new
    `UIConfigSchema.showExportPdf` flag.
  - **Imagery thumbnails**: `ImageryLayerConfigSchema` gains an optional
    `thumbnailUrl`. `ImageryPanel` renders the preview next to each layer
    (or a placeholder block when absent), and `ImageryEditor` exposes a
    Thumbnail URL field.

- 4ef3af6: Phase 5: new `SideMenuPanel` + `SideMenuToggle` components for grouping map controls into a slide-in menu. `UIConfigSchema` gains `controlLayout` (`individual` / `side-menu` / `auto`), `controlPositions` (per-control corner override), and `controlIcons` (per-control icon override by name). Exports a curated `CONTROL_ICON_MAP` / `CONTROL_ICON_NAMES` / `getControlIcon` helper. `UIConfigEditor` now renders a layout radio, per-control corner select, and per-control icon picker. Mobile-friendliness fixes: modals (`ExportModal`, `PdfExportDialog`, `ConfirmDialog`, `InfoModal`) get horizontal padding and scroll on narrow viewports.

### Patch Changes

- 482faf8: Fix shapefile export: migrate from the unmaintained `shp-write@0.3` to `@mapbox/shp-write@0.4` so browser exports actually work. The old version called `options.types` unconditionally (throwing when no options were passed) and only generated base64 strings via JSZip 2. The converter now requests a Blob directly, picks friendlier file names inside the zip, and surfaces clear errors for empty feature collections or features without geometry.

## 0.15.0

### Minor Changes

- 68987c0: custom queries

## 0.14.0

### Minor Changes

- 277bb19: imagery layers

## 0.13.0

### Minor Changes

- 2f84854: export style improvements

## 0.12.3

### Patch Changes

- 012878d: legend autogenerate label based on layer label

## 0.12.2

### Patch Changes

- 8219573: polygon selection tool

## 0.12.1

### Patch Changes

- aef3ba5: tool tips and layer flyout configurable per layer

## 0.12.0

### Minor Changes

- e3f0363: map branding configuration

## 0.11.0

### Minor Changes

- cd75fde: selection tool

## 0.10.0

### Minor Changes

- df8611e: measure tool panel

## 0.9.0

### Minor Changes

- c5c4a66: legend enhancements

## 0.8.0

### Minor Changes

- f082fcd: legend editor improvements and autostyle

## 0.7.0

### Minor Changes

- 3aaf019: multi style support

## 0.6.2

### Patch Changes

- e9c7bc9: export geom, update docs

## 0.6.1

### Patch Changes

- 8132a8d: expanded legend with opacity filter

## 0.6.0

### Minor Changes

- 76e64a3: style editor updates and info tip

## 0.5.3

### Patch Changes

- 7a40868: support more maplibre style options

## 0.5.2

### Patch Changes

- 79b4cf1: fix SearchFieldEditor

## 0.5.1

### Patch Changes

- 1a31b3d: layer summary and sorting

## 0.5.0

### Minor Changes

- 8409cf5: more search features using cql

## 0.4.1

### Patch Changes

- 866afbe: export menu style, hidetitle prop

## 0.4.0

### Minor Changes

- 55bdf1d: collapsible control button update

## 0.3.0

### Minor Changes

- 71b5ace: add export, tooltip, and flyout components

## 0.2.3

### Patch Changes

- 2412fbc: add default styles

## 0.2.2

### Patch Changes

- 0cffbc5: packaging updates

## 0.2.1

### Patch Changes

- 4fbe824: add npm package readme

## 0.2.0

### Minor Changes

- 11c1c36: initial public release
