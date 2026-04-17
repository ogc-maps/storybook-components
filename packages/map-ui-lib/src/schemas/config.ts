import { z } from 'zod';

// --- Geometry Type ---

export const GeometryTypeSchema = z.enum([
  'Point', 'MultiPoint',
  'LineString', 'MultiLineString',
  'Polygon', 'MultiPolygon',
]);

// --- Expression Support ---

const ExpressionSchema = z.array(z.unknown());
const colorOrExpr = (defaultColor: string) =>
  z.union([z.string(), ExpressionSchema]).default(defaultColor);
const colorOrExprOptional = () => z.union([z.string(), ExpressionSchema]).optional();

// --- View Configuration ---

export const ViewConfigSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    zoom: z.number().min(0).max(24),
    pitch: z.number().min(0).max(85).default(0),
    bearing: z.number().min(-180).max(180).default(0),
    minZoom: z.number().min(0).max(24).optional(),
    maxZoom: z.number().min(0).max(24).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.minZoom != null && data.maxZoom != null && data.minZoom > data.maxZoom) {
      ctx.addIssue({
        code: 'custom',
        path: ['minZoom'],
        message: 'minZoom must be less than or equal to maxZoom',
      });
    }
    if (data.minZoom != null && data.zoom < data.minZoom) {
      ctx.addIssue({
        code: 'custom',
        path: ['zoom'],
        message: `Zoom must be at least ${data.minZoom} (minZoom)`,
      });
    }
    if (data.maxZoom != null && data.zoom > data.maxZoom) {
      ctx.addIssue({
        code: 'custom',
        path: ['zoom'],
        message: `Zoom must be at most ${data.maxZoom} (maxZoom)`,
      });
    }
  });

// --- Source Authentication ---

export const SourceAuthSchema = z.object({
  type: z.enum(['query_param', 'header']),
  name: z.string().min(1),
  value: z.string().min(1),
});

// --- OGC API Source ---

export const OgcApiSourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  label: z.string().optional(),
  tileMatrixSetId: z.string().optional().default('WebMercatorQuad'),
  type: z.enum(['features', 'imagery']).optional(),
  auth: SourceAuthSchema.optional(),
  proxy: z.boolean().optional(),
});

// --- WMTS Source ---

export const WmtsSourceSchema = z.object({
  id: z.string().min(1),
  sourceType: z.literal('wmts'),
  capabilitiesUrl: z.string().url(),
  layer: z.string().min(1),
  style: z.string().default('default'),
  format: z.string().default('image/png'),
  tileMatrixSet: z.string().default('WebMercatorQuad'),
  /** Pre-built MapLibre tile URL template; overrides the auto-generated one. */
  tileUrlTemplate: z.string().optional(),
  label: z.string().optional(),
  tileSize: z.number().default(256),
  auth: SourceAuthSchema.optional(),
  proxy: z.boolean().optional(),
});

/** Union of all supported map sources. */
export const MapSourceSchema = z.union([WmtsSourceSchema, OgcApiSourceSchema]);

// --- Paint Schemas (MapLibre GL JS conventions) ---

export const FillPaintSchema = z.object({
  'fill-color': colorOrExpr('#000000'),
  'fill-opacity': z.number().min(0).max(1).default(1),
  'fill-outline-color': colorOrExprOptional(),
  'fill-antialias': z.boolean().optional(),
  'fill-translate': z.tuple([z.number(), z.number()]).optional(),
  'fill-translate-anchor': z.enum(['map', 'viewport']).optional(),
  'fill-pattern': z.string().optional(),
});

export const LinePaintSchema = z.object({
  'line-color': colorOrExpr('#000000'),
  'line-width': z.number().min(0).default(1),
  'line-opacity': z.number().min(0).max(1).default(1),
  'line-dasharray': z.array(z.number()).optional(),
  'line-translate': z.tuple([z.number(), z.number()]).optional(),
  'line-translate-anchor': z.enum(['map', 'viewport']).optional(),
  'line-gap-width': z.number().min(0).optional(),
  'line-offset': z.number().optional(),
  'line-blur': z.number().min(0).optional(),
  'line-pattern': z.string().optional(),
  'line-gradient': z.string().optional(),
});

export const CirclePaintSchema = z.object({
  'circle-color': colorOrExpr('#000000'),
  'circle-radius': z.number().min(0).default(5),
  'circle-opacity': z.number().min(0).max(1).default(1),
  'circle-stroke-color': colorOrExprOptional(),
  'circle-stroke-width': z.number().min(0).optional(),
  'circle-blur': z.number().min(0).optional(),
  'circle-translate': z.tuple([z.number(), z.number()]).optional(),
  'circle-translate-anchor': z.enum(['map', 'viewport']).optional(),
  'circle-pitch-scale': z.enum(['map', 'viewport']).optional(),
  'circle-pitch-alignment': z.enum(['map', 'viewport']).optional(),
  'circle-stroke-opacity': z.number().min(0).max(1).optional(),
});

export const SymbolPaintSchema = z.object({
  'icon-opacity': z.number().min(0).max(1).optional(),
  'icon-color': colorOrExprOptional(),
  'icon-halo-color': colorOrExprOptional(),
  'icon-halo-width': z.number().min(0).optional(),
  'icon-halo-blur': z.number().min(0).optional(),
  'icon-translate': z.tuple([z.number(), z.number()]).optional(),
  'icon-translate-anchor': z.enum(['map', 'viewport']).optional(),
  'text-opacity': z.number().min(0).max(1).optional(),
  'text-color': colorOrExprOptional(),
  'text-halo-color': colorOrExprOptional(),
  'text-halo-width': z.number().min(0).optional(),
  'text-halo-blur': z.number().min(0).optional(),
  'text-translate': z.tuple([z.number(), z.number()]).optional(),
  'text-translate-anchor': z.enum(['map', 'viewport']).optional(),
});

// --- Layout Schemas ---

export const FillLayoutSchema = z.object({
  'fill-sort-key': z.number().optional(),
  visibility: z.enum(['visible', 'none']).optional(),
});

export const LineLayoutSchema = z.object({
  'line-cap': z.enum(['butt', 'round', 'square']).optional(),
  'line-join': z.enum(['bevel', 'round', 'miter']).optional(),
  'line-miter-limit': z.number().optional(),
  'line-round-limit': z.number().optional(),
  'line-sort-key': z.number().optional(),
  visibility: z.enum(['visible', 'none']).optional(),
});

export const CircleLayoutSchema = z.object({
  'circle-sort-key': z.number().optional(),
  visibility: z.enum(['visible', 'none']).optional(),
});

export const SymbolLayoutSchema = z.object({
  'symbol-placement': z.enum(['point', 'line', 'line-center']).optional(),
  'symbol-spacing': z.number().min(1).optional(),
  'symbol-avoid-edges': z.boolean().optional(),
  'symbol-sort-key': z.number().optional(),
  'symbol-z-order': z.enum(['auto', 'viewport-y', 'source']).optional(),
  'icon-allow-overlap': z.boolean().optional(),
  'icon-ignore-placement': z.boolean().optional(),
  'icon-optional': z.boolean().optional(),
  'icon-rotation-alignment': z.enum(['map', 'viewport', 'auto']).optional(),
  'icon-size': z.number().min(0).optional(),
  'icon-text-fit': z.enum(['none', 'width', 'height', 'both']).optional(),
  'icon-text-fit-padding': z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  'icon-image': z.string().optional(),
  'icon-rotate': z.number().optional(),
  'icon-padding': z.number().min(0).optional(),
  'icon-keep-upright': z.boolean().optional(),
  'icon-offset': z.tuple([z.number(), z.number()]).optional(),
  'icon-anchor': z.enum(['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  'icon-pitch-alignment': z.enum(['map', 'viewport', 'auto']).optional(),
  'text-pitch-alignment': z.enum(['map', 'viewport', 'auto']).optional(),
  'text-rotation-alignment': z.enum(['map', 'viewport', 'viewport-glyph', 'auto']).optional(),
  'text-field': z.string().optional(),
  'text-font': z.array(z.string()).optional(),
  'text-size': z.number().min(0).optional(),
  'text-max-width': z.number().min(0).optional(),
  'text-line-height': z.number().optional(),
  'text-letter-spacing': z.number().optional(),
  'text-justify': z.enum(['auto', 'left', 'center', 'right']).optional(),
  'text-anchor': z.enum(['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  'text-max-angle': z.number().optional(),
  'text-rotate': z.number().optional(),
  'text-padding': z.number().min(0).optional(),
  'text-keep-upright': z.boolean().optional(),
  'text-transform': z.enum(['none', 'uppercase', 'lowercase']).optional(),
  'text-offset': z.tuple([z.number(), z.number()]).optional(),
  'text-allow-overlap': z.boolean().optional(),
  'text-ignore-placement': z.boolean().optional(),
  'text-optional': z.boolean().optional(),
  visibility: z.enum(['visible', 'none']).optional(),
});

// --- Style Config (Discriminated Union) ---

export const FillStyleSchema = z.object({
  type: z.literal('fill'),
  paint: FillPaintSchema,
  layout: FillLayoutSchema.optional(),
  geometryFilter: z.array(GeometryTypeSchema).optional(),
});

export const LineStyleSchema = z.object({
  type: z.literal('line'),
  paint: LinePaintSchema,
  layout: LineLayoutSchema.optional(),
  geometryFilter: z.array(GeometryTypeSchema).optional(),
});

export const CircleStyleSchema = z.object({
  type: z.literal('circle'),
  paint: CirclePaintSchema,
  layout: CircleLayoutSchema.optional(),
  geometryFilter: z.array(GeometryTypeSchema).optional(),
});

export const SymbolStyleSchema = z.object({
  type: z.literal('symbol'),
  paint: SymbolPaintSchema,
  layout: SymbolLayoutSchema.optional(),
  geometryFilter: z.array(GeometryTypeSchema).optional(),
});

export const StyleConfigSchema = z.discriminatedUnion('type', [
  FillStyleSchema,
  LineStyleSchema,
  CircleStyleSchema,
  SymbolStyleSchema,
]);

// --- Legend Config ---

export const LegendEntrySchema = z.object({
  label: z.string(),
  color: z.string(),
  shape: z.enum(['circle', 'line', 'square']).optional(),
});

export const LegendConfigSchema = z.object({
  entries: z.array(LegendEntrySchema).min(1),
  displayMode: z.enum(['categorical', 'gradient', 'simple']).optional(),
  showLabelsCollapsed: z.boolean().optional(),
  showColorBar: z.boolean().optional(),
  showDisclosureArrow: z.boolean().optional(),
  gradientProperty: z.string().optional(),
});

// --- Search Config ---

const searchFieldBase = {
  property: z.string().min(1),
  label: z.string(),
  placeholder: z.string().optional(),
};

export const TextSearchFieldSchema = z.object({
  ...searchFieldBase,
  type: z.literal('text'),
  autocomplete: z.boolean().default(false),
  prefetch: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  zoomTo: z.boolean().optional(),
});

export const NumberSearchFieldSchema = z.object({
  ...searchFieldBase,
  type: z.literal('number'),
  inputMode: z.enum(['input', 'slider']).default('input'),
  operator: z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'between']).default('eq'),
  operatorLabelStyle: z.enum(['symbol', 'word']).optional(),
  showRange: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});

export const DatetimeSearchFieldSchema = z.object({
  ...searchFieldBase,
  type: z.literal('datetime'),
  range: z.boolean().default(false),
});

export const SelectSearchFieldSchema = z.object({
  ...searchFieldBase,
  type: z.literal('select'),
  options: z.array(z.string()).optional(),
  prefetch: z.boolean().optional(),
  zoomTo: z.boolean().optional(),
});

export const SearchFieldSchema = z.discriminatedUnion('type', [
  TextSearchFieldSchema,
  NumberSearchFieldSchema,
  DatetimeSearchFieldSchema,
  SelectSearchFieldSchema,
]);

export const SearchConfigSchema = z.object({
  fields: z.array(SearchFieldSchema).min(1),
});

// --- Global Search Config ---

export const GlobalSearchPropertySchema = z.object({
  property: z.string().min(1),
  label: z.string().optional(),
  autocomplete: z.boolean().optional(),
  prefetch: z.boolean().optional(),
});

export const GlobalSearchLayerConfigSchema = z.object({
  layerId: z.string().min(1),
  properties: z.array(GlobalSearchPropertySchema).min(1),
});

export const GlobalSearchConfigSchema = z.object({
  enabled: z.boolean().default(true),
  placeholder: z.string().optional(),
  maxResultsPerLayer: z.number().int().min(1).max(50).default(10),
  debounceMs: z.number().int().min(0).default(250),
  minQueryLength: z.number().int().min(1).default(2),
  layers: z.array(GlobalSearchLayerConfigSchema).default([]),
});

// --- Property Display Config ---

export const PropertyDisplaySchema = z.object({
  label: z.string().optional(),
  visible: z.boolean().optional().default(true),
});

export const PropertyDisplayConfigSchema = z.record(z.string(), PropertyDisplaySchema);

// --- Filter Config ---

export const FilterConfigSchema = z.object({
  properties: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  datetime: z.string().optional(),
});

// --- CQL2 Filter Builder Config ---

export const FilterOperatorSchema = z.enum([
  '=', '<>', '>', '>=', '<', '<=',
  'like', 'in', 'isNull',
  'between',
  't_after', 't_before', 't_during',
  's_intersects', 's_within', 's_dwithin',
]);

const StaticFilterValueSchema = z.object({
  kind: z.literal('static'),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.string()),
    z.object({ lower: z.number(), upper: z.number() }),
    z.object({ start: z.string(), end: z.string() }),
  ]),
});

const ParameterFilterValueSchema = z.object({
  kind: z.literal('parameter'),
  name: z.string().min(1),
  label: z.string(),
  inputType: z.enum(['text', 'number', 'date', 'select']),
  default: z.union([z.string(), z.number()]).optional(),
});

const OffsetValueSchema = z.union([
  z.object({ kind: z.literal('static'), value: z.number() }),
  z.object({ kind: z.literal('parameter'), name: z.string().min(1), label: z.string(), default: z.number().optional() }),
]);

export const RelativeDateValueSchema = z.object({
  kind: z.literal('relativeDate'),
  direction: z.enum(['past', 'future']),
  offset: OffsetValueSchema,
  unit: z.enum(['days', 'months', 'years']),
});

const DateEndpointSchema = z.union([
  z.object({ kind: z.literal('static'), value: z.string() }),
  RelativeDateValueSchema,
  z.object({ kind: z.literal('parameter'), name: z.string(), label: z.string(), default: z.string().optional() }),
]);

export const DateRangeValueSchema = z.object({
  kind: z.literal('dateRange'),
  start: DateEndpointSchema,
  end: DateEndpointSchema,
});

export const ComputedRangeValueSchema = z.object({
  kind: z.literal('computedRange'),
  baseParam: z.string().min(1),
  baseLabel: z.string(),
  offsetType: z.enum(['percentage', 'absolute']),
  offsetAmount: OffsetValueSchema,
});

export const FilterRuleValueSchema = z.discriminatedUnion('kind', [
  StaticFilterValueSchema,
  ParameterFilterValueSchema,
  RelativeDateValueSchema,
  DateRangeValueSchema,
  ComputedRangeValueSchema,
]);

export const DISTANCE_UNITS = ['meters', 'kilometers', 'miles', 'feet'] as const;
const DistanceUnitSchema = z.enum(DISTANCE_UNITS);

export const SpatialDistanceParamSchema = z.object({
  kind: z.literal('parameter'),
  name: z.string().min(1),
  label: z.string(),
  default: z.number().optional(),
});

export const SpatialUnitsParamSchema = z.object({
  kind: z.literal('parameter'),
  name: z.string().min(1),
  label: z.string(),
  default: DistanceUnitSchema.optional(),
});

export const SpatialConfigSchema = z.object({
  distance: z.union([z.number(), SpatialDistanceParamSchema]).optional(),
  units: DistanceUnitSchema.optional(),
});

export const FilterRuleSchema = z.object({
  id: z.string(),
  property: z.string(),
  operator: FilterOperatorSchema,
  value: FilterRuleValueSchema,
  spatial: SpatialConfigSchema.optional(),
});

export const SortFieldSchema = z.object({
  property: z.string(),
  direction: z.enum(['asc', 'desc']),
});

export const SpatialConstraintSchema = z.object({
  operator: z.enum(['s_intersects', 's_within', 's_dwithin']),
  geometryProperty: z.string(),
  distance: z.union([z.number(), SpatialDistanceParamSchema]).optional(),
  distanceUnits: z.union([DistanceUnitSchema, SpatialUnitsParamSchema]).optional(),
});

export const FilterRuleGroupSchema: z.ZodType<{
  id: string;
  combinator: 'and' | 'or';
  rules: (
    | z.infer<typeof FilterRuleSchema>
    | { id: string; combinator: 'and' | 'or'; rules: unknown[] }
  )[];
  sortby?: Array<{ property: string; direction: 'asc' | 'desc' }>;
  limit?: number;
  spatialConstraint?: z.infer<typeof SpatialConstraintSchema>;
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    combinator: z.enum(['and', 'or']),
    rules: z.array(z.union([FilterRuleSchema, FilterRuleGroupSchema])),
    sortby: z.array(SortFieldSchema).optional(),
    limit: z.number().min(1).optional(),
    spatialConstraint: SpatialConstraintSchema.optional(),
  }),
);

export const Cql2FilterConfigSchema = FilterRuleGroupSchema;

// --- Layer Config ---

const layerConfigFields = {
  id: z.string().min(1),
  sourceId: z.string().min(1),
  collection: z.string().min(1),
  label: z.string(),
  visible: z.boolean().default(true),
  dataMode: z.enum(['vector-tiles', 'geojson']),
  minZoom: z.number().min(0).max(24).optional(),
  maxZoom: z.number().min(0).max(24).optional(),
  /** Preferred zoom level used when zooming to a point/zero-area feature in this layer. */
  zoomToLevel: z.number().min(0).max(24).optional(),
  styles: z.array(StyleConfigSchema).optional(),
  legend: LegendConfigSchema.optional(),
  filters: FilterConfigSchema.optional(),
  search: SearchConfigSchema.optional(),
  propertyDisplay: PropertyDisplayConfigSchema.optional(),
  cql2Filter: Cql2FilterConfigSchema.optional(),
  showTooltip: z.boolean().optional(),
  showDetailPanel: z.boolean().optional(),
};

export const LayerConfigSchema = z.preprocess(
  (data) => {
    if (data && typeof data === 'object' && 'style' in data && !('styles' in data)) {
      const { style, ...rest } = data as Record<string, unknown>;
      return { ...rest, styles: style ? [style] : undefined };
    }
    return data;
  },
  z.object(layerConfigFields),
);

// --- Basemap Config ---

// A basemap URL is either an absolute http(s) URL or a same-origin relative
// path like "/api/basemaps/<id>/style.json" — the admin app generates the
// latter for basemaps derived from imagery sources.
const basemapUrl = z.string().refine(
  (v) => v.startsWith('/') || /^https?:\/\//i.test(v),
  { message: 'Must be an absolute http(s) URL or a path starting with "/"' },
);

export const BasemapConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  url: basemapUrl,
  thumbnail: basemapUrl.optional(),
});

// --- Sprite Source Config ---

export const SpriteSourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
});

// --- UI Config ---

/** Controls that appear in the top-right stack and can be reordered. */
export const ORDERABLE_CONTROLS = [
  'showLegend',
  'showSearchPanel',
  'showLayerPanel',
  'showMeasureTool',
  'showSelectionTool',
  'showImageryPanel',
  'showBasemapSwitcher',
  'showExportButton',
  'showCompass',
  'showInfoControl',
] as const;

export type OrderableControlKey = (typeof ORDERABLE_CONTROLS)[number];

/** Corners of the map where a control group can be anchored. */
export const CONTROL_CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type ControlCorner = (typeof CONTROL_CORNERS)[number];

/** Layout mode for map controls: individual buttons, a single side menu, or responsive auto. */
export const CONTROL_LAYOUTS = ['individual', 'side-menu', 'auto'] as const;
export type ControlLayout = (typeof CONTROL_LAYOUTS)[number];

export const COORDINATE_FORMATS = ['decimal-degrees', 'ddm', 'dms'] as const;
export type CoordinateFormat = (typeof COORDINATE_FORMATS)[number];

export const UIConfigSchema = z.object({
  showLayerPanel: z.boolean().default(true),
  showLegend: z.boolean().default(true),
  showBasemapSwitcher: z.boolean().default(true),
  showSearchPanel: z.boolean().default(false),
  showCoordinateDisplay: z.boolean().default(true),
  showFeatureDetail: z.boolean().default(true),
  showFeatureTooltip: z.boolean().default(true),
  showExportButton: z.boolean().default(true),
  /** When true, surfaces a "Export as PDF" option in the export modal. */
  showExportPdf: z.boolean().default(false),
  showLegendOpacity: z.boolean().default(false),
  showMeasureTool: z.boolean().default(false),
  showSelectionTool: z.boolean().default(false),
  showImageryPanel: z.boolean().default(false),
  showCompass: z.boolean().default(true),
  showGlobalSearch: z.boolean().default(false),
  showScaleBar: z.boolean().default(false),
  controlOrder: z.array(z.enum(ORDERABLE_CONTROLS)).optional(),
  /**
   * Optional per-control corner override. When absent or a control is not
   * listed, the control falls back to 'top-right' (existing behavior).
   */
  controlPositions: z.partialRecord(z.enum(ORDERABLE_CONTROLS), z.enum(CONTROL_CORNERS)).optional(),
  /**
   * How controls are presented: 'individual' renders each as its own button,
   * 'side-menu' collapses them into a SideMenuPanel, 'auto' picks based on
   * viewport width.
   */
  controlLayout: z.enum(CONTROL_LAYOUTS).default('individual'),
  /**
   * Corner where the side-menu toggle (hamburger) button appears when using
   * 'side-menu' or 'auto' layout. Defaults to 'top-right'.
   */
  sideMenuToggleCorner: z.enum(CONTROL_CORNERS).default('top-right'),
  /**
   * Optional per-control icon override. Keys are control keys (e.g. `showSearchPanel`),
   * values are icon names from `CONTROL_ICON_MAP`. Unknown names fall back to the
   * control's default icon.
   */
  controlIcons: z.partialRecord(z.enum(ORDERABLE_CONTROLS), z.string()).optional(),
  /**
   * Optional display order for legend layers (array of layer IDs).
   * When absent, the legend renders visible layers in their natural order.
   * IDs not in the list are appended in natural order; unknown IDs are ignored.
   */
  legendOrder: z.array(z.string()).optional(),
  coordinateFormat: z.enum(COORDINATE_FORMATS).default('decimal-degrees'),
});

/** Returns the effective control order, falling back to defaults and appending any missing keys. */
export function resolveControlOrder(config: z.infer<typeof UIConfigSchema>): readonly OrderableControlKey[] {
  if (!config.controlOrder || config.controlOrder.length === 0) {
    return ORDERABLE_CONTROLS;
  }
  const seen = new Set(config.controlOrder);
  const extra = ORDERABLE_CONTROLS.filter((k) => !seen.has(k));
  return [...config.controlOrder, ...extra];
}

/**
 * Returns the corner where a given control should render. Defaults to
 * 'top-right' when no override is configured for the control.
 */
export function resolveControlCorner(
  config: z.infer<typeof UIConfigSchema>,
  key: OrderableControlKey,
): ControlCorner {
  return config.controlPositions?.[key] ?? 'top-right';
}

/**
 * Groups controls by the corner they should render in, preserving the
 * configured `controlOrder` within each group.
 */
export function groupControlsByCorner(
  config: z.infer<typeof UIConfigSchema>,
): Record<ControlCorner, OrderableControlKey[]> {
  const groups: Record<ControlCorner, OrderableControlKey[]> = {
    'top-right': [],
    'top-left': [],
    'bottom-right': [],
    'bottom-left': [],
  };
  for (const key of resolveControlOrder(config)) {
    groups[resolveControlCorner(config, key)].push(key);
  }
  return groups;
}

// --- Branding Config ---

export const DEFAULT_HEADER_COLOR = '#1e293b';

export const BrandingConfigSchema = z.object({
  headerTitle: z.string().optional(),
  headerColor: z.string().optional(),
  browserTitle: z.string().optional(),
  faviconDataUrl: z.string().optional(),
  logoDataUrl: z.string().optional(),
  logoHeight: z.number().int().min(16).max(200).optional(),
});

// --- Imagery Layer Config ---

export const ImageryLayerConfigSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().default(''),
  collection: z.string().default(''),
  label: z.string(),
  visible: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  exclusive: z.boolean().default(false),
  minZoom: z.number().min(0).max(24).optional(),
  maxZoom: z.number().min(0).max(24).optional(),
  tileSize: z.number().default(256),
  tileUrlTemplate: z.string().optional(),
  /** Optional thumbnail image URL rendered beside the layer in ImageryPanel. */
  thumbnailUrl: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.tileUrlTemplate) {
    if (!data.sourceId) {
      ctx.addIssue({ code: 'custom', path: ['sourceId'], message: 'Source is required when not using a custom tile URL' });
    }
    if (!data.collection) {
      ctx.addIssue({ code: 'custom', path: ['collection'], message: 'Collection is required when not using a custom tile URL' });
    }
  }
});

// --- Info Config ---

export const INFO_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type InfoPosition = (typeof INFO_POSITIONS)[number];

export const InfoConfigSchema = z.object({
  enabled: z.boolean().default(false),
  title: z.string().optional(),
  markdown: z.string().default(''),
  position: z.enum(INFO_POSITIONS).default('top-right'),
});
export type InfoConfig = z.infer<typeof InfoConfigSchema>;

// --- Root Map Config ---

export const MapConfigSchema = z.object({
  sources: z.array(MapSourceSchema).min(1),
  layers: z.array(LayerConfigSchema),
  imageryLayers: z.array(ImageryLayerConfigSchema).optional(),
  basemaps: z.array(BasemapConfigSchema).min(1),
  sprites: z.array(SpriteSourceSchema).optional(),
  ui: UIConfigSchema.default({
    showLayerPanel: true,
    showLegend: true,
    showBasemapSwitcher: true,
    showSearchPanel: false,
    showCoordinateDisplay: true,
    showFeatureDetail: true,
    showFeatureTooltip: true,
    showExportButton: true,
    showExportPdf: false,
    showLegendOpacity: false,
    showMeasureTool: false,
    showSelectionTool: false,
    showImageryPanel: false,
    showCompass: true,
    showGlobalSearch: false,
    showScaleBar: false,
    controlLayout: 'individual',
    sideMenuToggleCorner: 'top-right',
    coordinateFormat: 'decimal-degrees',
  }),
  initialView: ViewConfigSchema,
  branding: BrandingConfigSchema.optional(),
  globalSearch: GlobalSearchConfigSchema.optional(),
  info: InfoConfigSchema.optional(),
});

// --- Validation Utilities ---

/**
 * Validates a map config, throwing a ZodError if invalid.
 */
export function validateMapConfig(config: unknown) {
  return MapConfigSchema.parse(config);
}

/**
 * Validates a map config, returning a safe result object instead of throwing.
 */
export function safeValidateMapConfig(config: unknown) {
  return MapConfigSchema.safeParse(config);
}
