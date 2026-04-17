import type { z } from 'zod';
import {
  GeometryTypeSchema,
  ViewConfigSchema,
  SourceAuthSchema,
  OgcApiSourceSchema,
  WmtsSourceSchema,
  MapSourceSchema,
  FillPaintSchema,
  LinePaintSchema,
  CirclePaintSchema,
  SymbolPaintSchema,
  FillLayoutSchema,
  LineLayoutSchema,
  CircleLayoutSchema,
  SymbolLayoutSchema,
  FillStyleSchema,
  LineStyleSchema,
  CircleStyleSchema,
  SymbolStyleSchema,
  StyleConfigSchema,
  LegendEntrySchema,
  LegendConfigSchema,
  TextSearchFieldSchema,
  NumberSearchFieldSchema,
  DatetimeSearchFieldSchema,
  SelectSearchFieldSchema,
  SearchFieldSchema,
  SearchConfigSchema,
  GlobalSearchPropertySchema,
  GlobalSearchLayerConfigSchema,
  GlobalSearchConfigSchema,
  FilterConfigSchema,
  PropertyDisplaySchema,
  PropertyDisplayConfigSchema,
  ImageryLayerConfigSchema,
  LayerConfigSchema,
  BasemapConfigSchema,
  SpriteSourceSchema,
  UIConfigSchema,
  ORDERABLE_CONTROLS,
  CONTROL_CORNERS,
  CONTROL_LAYOUTS,
  resolveControlOrder,
  resolveControlCorner,
  groupControlsByCorner,
  BrandingConfigSchema,
  InfoConfigSchema,
  INFO_POSITIONS,
  MapConfigSchema,
  FilterOperatorSchema,
  FilterRuleValueSchema,
  RelativeDateValueSchema,
  DateRangeValueSchema,
  ComputedRangeValueSchema,
  SpatialConfigSchema,
  SpatialConstraintSchema,
  FilterRuleSchema,
  FilterRuleGroupSchema,
  SortFieldSchema,
  Cql2FilterConfigSchema,
  DISTANCE_UNITS,
} from '../schemas/config';

// Inferred types from Zod schemas
export type GeometryType = z.infer<typeof GeometryTypeSchema>;
export type ViewConfig = z.infer<typeof ViewConfigSchema>;
export type SourceAuth = z.infer<typeof SourceAuthSchema>;
export type OgcApiSource = z.infer<typeof OgcApiSourceSchema>;
export type WmtsSource = z.infer<typeof WmtsSourceSchema>;
export type MapSource = z.infer<typeof MapSourceSchema>;

export type FillPaint = z.infer<typeof FillPaintSchema>;
export type LinePaint = z.infer<typeof LinePaintSchema>;
export type CirclePaint = z.infer<typeof CirclePaintSchema>;
export type SymbolPaint = z.infer<typeof SymbolPaintSchema>;

export type FillLayout = z.infer<typeof FillLayoutSchema>;
export type LineLayout = z.infer<typeof LineLayoutSchema>;
export type CircleLayout = z.infer<typeof CircleLayoutSchema>;
export type SymbolLayout = z.infer<typeof SymbolLayoutSchema>;

export type FillStyle = z.infer<typeof FillStyleSchema>;
export type LineStyle = z.infer<typeof LineStyleSchema>;
export type CircleStyle = z.infer<typeof CircleStyleSchema>;
export type SymbolStyle = z.infer<typeof SymbolStyleSchema>;
export type StyleConfig = z.infer<typeof StyleConfigSchema>;

export type LegendEntry = z.infer<typeof LegendEntrySchema>;
export type LegendConfig = z.infer<typeof LegendConfigSchema>;

export type TextSearchField = z.infer<typeof TextSearchFieldSchema>;
export type NumberSearchField = z.infer<typeof NumberSearchFieldSchema>;
export type DatetimeSearchField = z.infer<typeof DatetimeSearchFieldSchema>;
export type SelectSearchField = z.infer<typeof SelectSearchFieldSchema>;
export type SearchField = z.infer<typeof SearchFieldSchema>;
export type SearchConfig = z.infer<typeof SearchConfigSchema>;

export type GlobalSearchProperty = z.infer<typeof GlobalSearchPropertySchema>;
export type GlobalSearchLayerConfig = z.infer<typeof GlobalSearchLayerConfigSchema>;
export type GlobalSearchConfig = z.infer<typeof GlobalSearchConfigSchema>;

export type SearchFilterValue =
  | string
  | number
  | { start: string; end: string }
  | { value: number; operator: string }
  | { min: number; max: number }
  | undefined;

export type SearchFilterValues = Record<string, SearchFilterValue>;

export type FilterConfig = z.infer<typeof FilterConfigSchema>;

// CQL2 Filter Builder types
export type FilterOperator = z.infer<typeof FilterOperatorSchema>;
export type FilterRuleValue = z.infer<typeof FilterRuleValueSchema>;
export type RelativeDateValue = z.infer<typeof RelativeDateValueSchema>;
export type DateRangeValue = z.infer<typeof DateRangeValueSchema>;
export type ComputedRangeValue = z.infer<typeof ComputedRangeValueSchema>;
export type SpatialConfig = z.infer<typeof SpatialConfigSchema>;
export type SpatialConstraint = z.infer<typeof SpatialConstraintSchema>;
/** CQL2 spatial distance unit. Distinct from `DistanceUnit` in `utils/measure` (which uses abbreviations). */
export type Cql2DistanceUnit = (typeof DISTANCE_UNITS)[number];
export type FilterRule = z.infer<typeof FilterRuleSchema>;
export type SortField = z.infer<typeof SortFieldSchema>;

/**
 * A recursive group of filter rules combined with AND or OR.
 * Supports arbitrary nesting (groups within groups). The top-level group
 * may also carry `sortby` and `limit` for full query shaping.
 */
export interface FilterRuleGroup {
  id: string;
  combinator: 'and' | 'or';
  rules: (FilterRule | FilterRuleGroup)[];
  sortby?: SortField[];
  limit?: number;
  spatialConstraint?: SpatialConstraint;
}

/** Top-level CQL2 filter config stored in `LayerConfig.cql2Filter`. Alias for `FilterRuleGroup`. */
export type Cql2FilterConfig = FilterRuleGroup;

/**
 * Full query shape returned by `buildCql2Query()`. Includes the CQL2 filter expression
 * plus optional sort and limit metadata for OGC API queries.
 */
export interface Cql2QueryShape {
  filter: import('../utils/cql2').CQL2Expression | null;
  sortby?: SortField[];
  limit?: number;
}

export type PropertyDisplay = z.infer<typeof PropertyDisplaySchema>;
export type PropertyDisplayConfig = z.infer<typeof PropertyDisplayConfigSchema>;
export type PropertyDisplayConfigInput = z.input<typeof PropertyDisplayConfigSchema>;
export type ImageryLayerConfig = z.infer<typeof ImageryLayerConfigSchema>;
export type LayerConfig = z.infer<typeof LayerConfigSchema>;
export type BasemapConfig = z.infer<typeof BasemapConfigSchema>;
export type SpriteSource = z.infer<typeof SpriteSourceSchema>;
export type UIConfig = z.infer<typeof UIConfigSchema>;
export type { OrderableControlKey, ControlCorner, ControlLayout } from '../schemas/config';
export type BrandingConfig = z.infer<typeof BrandingConfigSchema>;
export type InfoConfig = z.infer<typeof InfoConfigSchema>;
export type { InfoPosition } from '../schemas/config';
export type MapConfig = z.infer<typeof MapConfigSchema>;

/** Callback for fetching distinct property values from an OGC API collection. */
export type FetchDistinctValuesFn = (
  property: string,
  options?: { maxFeatures?: number },
) => Promise<string[]>;

/** A queryable property from OGC API metadata, used to drive editor dropdowns. */
export interface AvailableProperty {
  name: string;
  title?: string;
  type?: string;
  format?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

// Re-export schemas for convenience
export {
  GeometryTypeSchema,
  ViewConfigSchema,
  SourceAuthSchema,
  OgcApiSourceSchema,
  WmtsSourceSchema,
  MapSourceSchema,
  FillPaintSchema,
  LinePaintSchema,
  CirclePaintSchema,
  SymbolPaintSchema,
  FillLayoutSchema,
  LineLayoutSchema,
  CircleLayoutSchema,
  SymbolLayoutSchema,
  FillStyleSchema,
  LineStyleSchema,
  CircleStyleSchema,
  SymbolStyleSchema,
  StyleConfigSchema,
  LegendEntrySchema,
  LegendConfigSchema,
  TextSearchFieldSchema,
  NumberSearchFieldSchema,
  DatetimeSearchFieldSchema,
  SelectSearchFieldSchema,
  SearchFieldSchema,
  SearchConfigSchema,
  GlobalSearchPropertySchema,
  GlobalSearchLayerConfigSchema,
  GlobalSearchConfigSchema,
  FilterConfigSchema,
  PropertyDisplaySchema,
  PropertyDisplayConfigSchema,
  ImageryLayerConfigSchema,
  LayerConfigSchema,
  BasemapConfigSchema,
  SpriteSourceSchema,
  UIConfigSchema,
  ORDERABLE_CONTROLS,
  CONTROL_CORNERS,
  CONTROL_LAYOUTS,
  resolveControlOrder,
  resolveControlCorner,
  groupControlsByCorner,
  BrandingConfigSchema,
  InfoConfigSchema,
  INFO_POSITIONS,
  MapConfigSchema,
  FilterOperatorSchema,
  FilterRuleValueSchema,
  RelativeDateValueSchema,
  DateRangeValueSchema,
  ComputedRangeValueSchema,
  SpatialConfigSchema,
  SpatialConstraintSchema,
  FilterRuleSchema,
  FilterRuleGroupSchema,
  SortFieldSchema,
  Cql2FilterConfigSchema,
  DISTANCE_UNITS,
};
