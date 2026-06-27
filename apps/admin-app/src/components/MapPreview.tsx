import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Map, Source, Layer, Marker, AttributionControl, type MapRef } from 'react-map-gl/maplibre';
import { useOgcFeatures, useExport, useHeaderAuthTransformRequest, useVectorSourceLayer } from '@ogc-maps/storybook-components/hooks';
import {
  getCql2FilteredVectorTileUrl,
  getImageryTileUrl,
  DEFAULT_EXPORT_FORMATS,
  fromStructuredFilters,
  resolvePropertyDisplay,
  fetchDistinctValues,
  resolveStyleWithSprites,
  fetchFeatures,
  fetchFeatureById,
  eq,
  zoomToFeature,
  applyZoomInstruction,
  featureCollectionFromGeometries,
  baseCql2FilterFromLayer,
  getVectorTileSourceKey,
  getSubLayerId,
  getStyleSubLayerIds,
  getLayerSourceKey,
  getLayerSubLayerIds,
  buildGeometryFilter,
  buildCql2Query,
  combineGeometries,
  propertyFiltersToCql2,
  and,
  mergeBaseAndActiveCql2Filters,
  expandDashByCategory,
  runGlobalSearch,
  prefetchAllDistinctValues,
  prefetchKey,
  type GlobalSearchContext,
  buildSourceUrlMap,
  isOgcApiSource,
} from '@ogc-maps/storybook-components/utils';
import type { CQL2Expression } from '@ogc-maps/storybook-components/utils';
import type { PropertyFilter } from '@ogc-maps/storybook-components/utils';
import {
  Legend,
  LayerPanel,
  ImageryPanel,
  BasemapSwitcher,
  SearchPanel,
  GlobalSearchBar,
  CollapsibleControl,
  CompassControl,
  CoordinateDisplay,
  FeatureDetailPanel,
  FeatureTooltip,
  ExportButton,
  ExportModal,
  MeasurePanel,
  SelectionPanel,
  QueryPanel,
  ResultsDrawer,
  InfoControl,
  InfoModal,
  SideMenuPanel,
  SideMenuToggle,
  getControlIcon,
  formatDecimal,
  formatDMS,
  groupControlsByCorner,
  resolveControlCorner,
  CONTROL_CORNERS,
  DEFAULT_GLOBAL_SEARCH_POSITION,
  DEFAULT_GLOBAL_SEARCH_WIDTH,
  isGlobalSearchCorner,
  globalSearchPositionClass,
  globalSearchWidthClass,
  type SideMenuPanelItem,
} from '@ogc-maps/storybook-components';
import type {
  CoordinateFormatOption,
  ExportRequest,
  ResultsDrawerTab,
  GlobalSearchFeatureMatch,
  GlobalSearchGroupedResults,
} from '@ogc-maps/storybook-components';
import type {
  MapSource,
  SourceAuth,
  LayerConfig,
  ImageryLayerConfig,
  BasemapConfig,
  SpriteSource,
  ViewConfig,
  UIConfig,
  ExportableLayer,
  OrderableControlKey,
  ControlCorner,
  InfoConfig,
  GlobalSearchConfig,
} from '@ogc-maps/storybook-components';
import type { SearchFilterValue, SearchFilterValues, Cql2FilterConfig, InfoPosition } from '@ogc-maps/storybook-components/types';
import { useMeasure, useSelection } from '@ogc-maps/storybook-components/hooks';

import { LuDownload, LuLayers3, LuList, LuMap, LuMousePointer2, LuRuler, LuSatellite, LuSearch } from 'react-icons/lu';
import { resolveEffectiveLayout } from './mapPreviewLayout';
import { useBoxDraw } from '../hooks/useBoxDraw';
import { usePolygonDraw } from '../hooks/usePolygonDraw';
import { useQueryablesByLayer } from '../hooks/useQueryablesByLayer';
import { proxifyWmtsSources } from '../utils/proxyPreview';
import { exportConverters } from '@ogc-maps/storybook-components/utils';

const coordinateFormats: CoordinateFormatOption[] = [
  { id: 'decimal', label: 'Decimal', format: formatDecimal },
  { id: 'dms', label: 'DMS', format: formatDMS },
];

const FALLBACK_BASEMAP_URL = 'https://demotiles.maplibre.org/style.json';

const INFO_CORNER_CLASSES: Record<InfoPosition, string> = {
  'top-right': 'mapui:absolute mapui:top-4 mapui:right-4 mapui:pointer-events-auto mapui:z-10',
  'top-left': 'mapui:absolute mapui:top-4 mapui:left-4 mapui:pointer-events-auto mapui:z-10',
  'bottom-right': 'mapui:absolute mapui:bottom-4 mapui:right-4 mapui:pointer-events-auto mapui:z-10',
  'bottom-left': 'mapui:absolute mapui:bottom-4 mapui:left-4 mapui:pointer-events-auto mapui:z-10',
};

const CORNER_CLASSES: Record<ControlCorner, string> = {
  'top-right': 'mapui:absolute mapui:top-4 mapui:right-4 mapui:flex mapui:flex-col mapui:gap-4 mapui:items-end',
  'top-left': 'mapui:absolute mapui:top-4 mapui:left-4 mapui:flex mapui:flex-col mapui:gap-4 mapui:items-start',
  'bottom-right': 'mapui:absolute mapui:bottom-4 mapui:right-4 mapui:flex mapui:flex-col mapui:gap-4 mapui:items-end',
  'bottom-left': 'mapui:absolute mapui:bottom-4 mapui:left-4 mapui:flex mapui:flex-col mapui:gap-4 mapui:items-start',
};

/**
 * Render a single style as one or more `<Layer>` elements. Most styles map
 * 1:1 to a Layer; a `line` style with `dashByCategory` expands to N+1
 * Layers (one per case + a default-case) so each can carry a static
 * `line-dasharray` — MapLibre data-constants this paint property.
 */
function renderPreviewStyleLayers(
  style: NonNullable<LayerConfig['styles']>[number],
  styleIndex: number,
  baseId: string,
  layer: LayerConfig,
  sourceLayer?: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commonProps: Record<string, any> = {
    type: style.type,
    layout: { ...(style.layout ?? {}), visibility: layer.visible ? 'visible' : 'none' },
    ...(layer.minZoom != null ? { minzoom: layer.minZoom } : {}),
    ...(layer.maxZoom != null ? { maxzoom: layer.maxZoom } : {}),
    ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
  };
  const baseFilter = style.geometryFilter ? buildGeometryFilter(style.geometryFilter) : undefined;
  const baseSubLayerId = getSubLayerId(baseId, style.type, styleIndex);

  if (style.type === 'line' && style.dashByCategory) {
    const expansions = expandDashByCategory(style);
    if (expansions.length > 0) {
      const sharedPaint = { ...style.paint } as Record<string, unknown>;
      delete sharedPaint['line-dasharray'];
      return expansions.map((sub) => {
        const filter = baseFilter ? ['all', baseFilter, sub.filter] : sub.filter;
        return (
          <Layer
            key={`${style.type}--${styleIndex}--${sub.idSuffix}`}
            id={`${baseSubLayerId}--${sub.idSuffix}`}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            paint={{ ...sharedPaint, 'line-dasharray': sub.dasharray } as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            filter={filter as any}
            {...(commonProps as any)}
          />
        );
      });
    }
  }

  return [
    <Layer
      key={`${style.type}--${styleIndex}`}
      id={baseSubLayerId}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      paint={style.paint as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(baseFilter ? { filter: baseFilter as any } : {})}
      {...(commonProps as any)}
    />,
  ];
}

function PreviewVectorTileLayer({
  layer,
  sourceUrl,
  tileMatrixSetId,
  cql2Filter,
  auth,
}: {
  layer: LayerConfig;
  sourceUrl: string;
  tileMatrixSetId?: string;
  cql2Filter?: CQL2Expression | null;
  auth?: SourceAuth;
}) {
  const tileUrl = getCql2FilteredVectorTileUrl(sourceUrl, layer.collection, cql2Filter, tileMatrixSetId, auth);
  // Resolve the MVT `source-layer` from the collection's TileJSON (handles tipg
  // instances that name the tile layer `default` rather than the table name).
  const sourceLayer = useVectorSourceLayer(sourceUrl, layer.collection, tileMatrixSetId, auth);
  const sourceKey = getVectorTileSourceKey(layer.id, cql2Filter);
  // Fold the resolved source-layer into the React key only — remounts the
  // Source/Layers when the name resolves without changing the MapLibre ids that
  // interactiveLayerIds / paint-sync / reorder / selection rebuild via getSubLayerId.
  const remountKey = `${sourceKey}::${sourceLayer}`;

  if (!layer.styles?.length) return null;

  return (
    <Source id={sourceKey} key={remountKey} type="vector" tiles={[tileUrl]}>
      {layer.styles.flatMap((style, i) => renderPreviewStyleLayers(style, i, sourceKey, layer, sourceLayer))}
    </Source>
  );
}

function PreviewGeoJsonLayer({
  layer,
  sourceUrl,
  cql2Filter,
  auth,
}: {
  layer: LayerConfig;
  sourceUrl: string;
  cql2Filter?: CQL2Expression | null;
  auth?: SourceAuth;
}) {
  const { features } = useOgcFeatures(sourceUrl, layer.collection, { limit: 10000, cql2Filter: cql2Filter ?? undefined }, auth);

  const featureCollection = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: features || [],
    }),
    [features],
  );

  if (!layer.styles?.length) return null;

  return (
    <Source id={layer.id} key={layer.id} type="geojson" data={featureCollection}>
      {layer.styles.flatMap((style, i) => renderPreviewStyleLayers(style, i, layer.id, layer))}
    </Source>
  );
}

function PreviewRasterImageryLayer({
  layer,
  sourceUrl,
  tileMatrixSetId,
  auth,
  sourceTileUrlTemplate,
}: {
  layer: ImageryLayerConfig;
  sourceUrl: string;
  tileMatrixSetId?: string;
  auth?: SourceAuth;
  sourceTileUrlTemplate?: string;
}) {
  const template = sourceTileUrlTemplate ?? layer.tileUrlTemplate;
  const tileUrl = getImageryTileUrl(sourceUrl, layer.collection, tileMatrixSetId, template, auth);
  return (
    <Source
      id={`imagery-${layer.id}`}
      key={`imagery-${layer.id}`}
      type="raster"
      tiles={[tileUrl]}
      tileSize={layer.tileSize ?? 256}
      {...(layer.minZoom != null ? { minzoom: layer.minZoom } : {})}
      {...(layer.maxZoom != null ? { maxzoom: layer.maxZoom } : {})}
    >
      <Layer
        id={`imagery-${layer.id}`}
        type="raster"
        paint={{ 'raster-opacity': layer.opacity ?? 1 }}
        layout={{ visibility: layer.visible ? 'visible' : 'none' }}
        {...(layer.minZoom != null ? { minzoom: layer.minZoom } : {})}
        {...(layer.maxZoom != null ? { maxzoom: layer.maxZoom } : {})}
      />
    </Source>
  );
}

export interface MapPreviewProps {
  sources: MapSource[];
  layers: LayerConfig[];
  imageryLayers?: ImageryLayerConfig[];
  basemaps: BasemapConfig[];
  sprites?: SpriteSource[];
  viewState: ViewConfig;
  onViewStateChange?: (view: ViewConfig) => void;
  onLayersChange?: (layers: LayerConfig[]) => void;
  onImageryLayersChange?: (layers: ImageryLayerConfig[]) => void;
  currentStep: string;
  uiConfig?: UIConfig;
  info?: InfoConfig;
  globalSearch?: GlobalSearchConfig;
}

export function MapPreview({
  sources,
  layers,
  imageryLayers: imageryLayersProp,
  basemaps,
  sprites,
  viewState,
  onViewStateChange,
  onLayersChange,
  onImageryLayersChange,
  currentStep,
  uiConfig,
  info,
  globalSearch,
}: MapPreviewProps) {
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [internalViewState, setInternalViewState] = useState<ViewConfig>(viewState);
  const [activeBasemapId, setActiveBasemapId] = useState<string | undefined>(basemaps[0]?.id);
  const [resolvedStyle, setResolvedStyle] = useState<string | object>(
    basemaps[0]?.url ?? FALLBACK_BASEMAP_URL,
  );
  const [activeFilters, setActiveFilters] = useState<Record<string, SearchFilterValues>>({});
  // Search-derived CQL2 (NOT including the saved layer.cql2Filter base). Set by SearchPanel/PropertyFilter callbacks.
  const [activeCql2Filters, setActiveCql2Filters] = useState<Record<string, CQL2Expression | undefined>>({});

  // Effective per-layer filter = saved layer.cql2Filter (base) AND search-derived (active).
  // Use this in place of activeCql2Filters at every consumer (vector tile URL,
  // source key, fetchFeatures, hasActiveFilter, etc.) so saved base filters
  // apply on first render and across reloads, not just after the user touches
  // a search field. MapLibre re-fetches tiles only when both the React key AND
  // the Source/Layer id change — including the merged filter in
  // getVectorTileSourceKey ensures both flip together.
  const effectiveCql2Filters = useMemo(
    () => mergeBaseAndActiveCql2Filters(layers, activeCql2Filters),
    [layers, activeCql2Filters],
  );
  const [propertyFilters, setPropertyFilters] = useState<PropertyFilter[]>([]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [mouseCoords, setMouseCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [coordFormat, setCoordFormat] = useState<string>('decimal');
  const [selectedFeatures, setSelectedFeatures] = useState<{
    properties: Record<string, unknown>;
    title?: string;
    fields?: string[];
    labels?: Record<string, string>;
  }[]>([]);
  const [hoveredFeatures, setHoveredFeatures] = useState<{
    properties: Record<string, unknown>;
    title?: string;
    fields?: string[];
    labels?: Record<string, string>;
  }[]>([]);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number } | null>(null);
  const [openControl, setOpenControl] = useState<string | null>(null);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const effectiveLayout = resolveEffectiveLayout(uiConfig?.controlLayout, isNarrowViewport);

  // Global search state — mirrors map-client's useGlobalSearch with local
  // useState instead of a Zustand store, since the admin preview is a
  // self-contained sandbox.
  const globalSearchEnabled =
    uiConfig?.showGlobalSearch === true && globalSearch?.enabled === true;
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchResults, setGlobalSearchResults] =
    useState<GlobalSearchGroupedResults>({});
  const [globalSearchIsLoading, setGlobalSearchIsLoading] = useState(false);
  const [prefetchedDistinctValues, setPrefetchedDistinctValues] = useState<
    Record<string, string[]>
  >({});
  const globalSearchInFlightRef = useRef<AbortController | null>(null);
  const globalSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Features matched by the most recent search (global search or SearchPanel
  // zoom-to), rendered as the `search-highlight` source. Persists until the
  // next search or a manual clear.
  const [searchHighlightData, setSearchHighlightData] = useState<GeoJSON.FeatureCollection | null>(null);

  const [cursor, setCursor] = useState<string>('auto');
  const { queryablesByLayer } = useQueryablesByLayer(layers, sources);
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<Record<string, string[]>>({});
  const prefetchedRef = useRef<Set<string>>(new Set());
  const debounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(hoverTimerRef.current), []);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const mapRef = useRef<MapRef>(null);
  const [droppedPin, setDroppedPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pinDropActive, setPinDropActive] = useState(false);
  const goToCoordinate = useCallback((lat: number, lng: number) => {
    mapInstance?.flyTo({ center: [lng, lat], zoom: 17 });
    setDroppedPin({ latitude: lat, longitude: lng });
  }, [mapInstance]);
  const [imageryVisibility, setImageryVisibility] = useState<Record<string, boolean>>({});
  const imageryLayers = useMemo(() =>
    (imageryLayersProp ?? []).map(l => ({
      ...l,
      visible: imageryVisibility[l.id] ?? l.visible,
    })),
    [imageryLayersProp, imageryVisibility],
  );
  const imageryLayerIds = useMemo(
    () => (imageryLayersProp ?? []).map(l => l.id),
    [imageryLayersProp],
  );

  const handleToggleImageryVisibility = useCallback((layerId: string) => {
    setImageryVisibility(prev => {
      const current = prev[layerId] ?? imageryLayersProp?.find(l => l.id === layerId)?.visible ?? false;
      const newVisible = !current;
      const target = imageryLayersProp?.find(l => l.id === layerId);
      if (!target) return prev;

      const next: Record<string, boolean> = { ...prev, [layerId]: newVisible };
      if (newVisible) {
        for (const l of imageryLayersProp ?? []) {
          if (l.id === layerId) continue;
          if (target.exclusive) { next[l.id] = false; }
          else if (l.exclusive && (prev[l.id] ?? l.visible)) { next[l.id] = false; }
        }
      }
      return next;
    });
  }, [imageryLayersProp]);

  const handleImageryOpacity = useCallback((layerId: string, opacity: number) => {
    onImageryLayersChange?.(
      (imageryLayersProp ?? []).map(l => l.id === layerId ? { ...l, opacity } : l),
    );
  }, [imageryLayersProp, onImageryLayersChange]);

  const measure = useMeasure();
  const selection = useSelection();
  const [resultsOpen, setResultsOpen] = useState(false);

  // Query state
  const [queryResults, setQueryResults] = useState<Array<{ properties: Record<string, unknown>; geometry?: Record<string, unknown> }> | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [resultsActiveTab, setResultsActiveTab] = useState<string>('selected');

  const activeLayer = useMemo(
    () => layers.find((l) => l.id === selection.activeLayerId),
    [layers, selection.activeLayerId],
  );

  // Clear query results when layer changes
  useEffect(() => { setQueryResults(null); setQueryError(null); }, [selection.activeLayerId]);

  const handleRunQuery = useCallback(async (params: Record<string, unknown>) => {
    if (!activeLayer?.cql2Filter) return;
    const source = sources.find((s) => s.id === activeLayer.sourceId);
    if (!source || !isOgcApiSource(source)) return;

    const selectionGeometry = combineGeometries(selection.features.map((f) => f.geometry));
    setQueryLoading(true);
    setQueryError(null);
    try {
      const query = buildCql2Query(activeLayer.cql2Filter as Cql2FilterConfig, params, selectionGeometry as any);
      const data = await fetchFeatures(source.url, activeLayer.collection, {
        cql2Filter: query.filter ?? undefined,
        limit: query.limit,
        sortby: query.sortby,
      });
      setQueryResults(data.features.map((f) => ({ properties: (f.properties ?? {}) as Record<string, unknown>, geometry: f.geometry as Record<string, unknown> | undefined })));
      setResultsActiveTab('query');
      setResultsOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Query failed';
      setQueryError(message);
      console.error('Query failed:', err);
    } finally {
      setQueryLoading(false);
    }
  }, [activeLayer, sources, selection.features]);

  // Build tabs for ResultsDrawer
  const resultsTabs = useMemo((): ResultsDrawerTab[] => {
    const tabs: ResultsDrawerTab[] = [{
      id: 'selected',
      label: 'Selected Features',
      features: selection.features.map((f) => ({ properties: f.properties, geometry: f.geometry })),
      onClear: () => { selection.clearFeatures(); if (!queryResults) setResultsOpen(false); },
    }];
    if (queryResults) {
      tabs.push({
        id: 'query',
        label: 'Query Results',
        features: queryResults,
        onClear: () => { setQueryResults(null); setResultsActiveTab('selected'); },
      });
    }
    return tabs;
  }, [selection.features, queryResults]);

  // Query results highlight data for the map
  const queryHighlightData = useMemo(() => {
    if (!queryResults?.length) return null;
    return {
      type: 'FeatureCollection' as const,
      features: queryResults.filter((f) => f.geometry).map((f, i) => ({
        type: 'Feature' as const,
        id: i,
        properties: {},
        geometry: f.geometry!,
      })),
    };
  }, [queryResults]);

  const selectionQueryLayerIds = useMemo(() => {
    if (!selection.activeLayerId) return [];
    const layer = layers.find((l) => l.id === selection.activeLayerId);
    if (!layer) return [];
    return getLayerSubLayerIds(layer, effectiveCql2Filters[layer.id]);
  }, [selection.activeLayerId, layers, effectiveCql2Filters]);

  const handleSpatialSelectionComplete = useCallback(
    (features: Array<{ id?: string | number; properties: Record<string, unknown>; geometry: Record<string, unknown> }>) => {
      if (!selection.activeLayerId) return;
      selection.addFeatures(
        features.map((f) => ({ id: f.id, layerId: selection.activeLayerId!, properties: f.properties, geometry: f.geometry })),
      );
    },
    [selection.activeLayerId, selection.addFeatures],
  );

  const { boxDrawData } = useBoxDraw({
    mapRef,
    enabled: selection.mode === 'box' && selection.activeLayerId != null,
    queryLayerIds: selectionQueryLayerIds,
    onComplete: handleSpatialSelectionComplete,
  });

  const polygonDraw = usePolygonDraw({
    mapRef,
    enabled: selection.mode === 'polygon' && selection.activeLayerId != null,
    queryLayerIds: selectionQueryLayerIds,
    onComplete: handleSpatialSelectionComplete,
  });

  // Reset viewport when entering the view step or when the prop changes while on that step
  useEffect(() => {
    if (onViewStateChange) {
      setInternalViewState(viewState);
    }
  }, [onViewStateChange, viewState]);

  // Sync activeBasemapId when basemaps change
  useEffect(() => {
    setActiveBasemapId(prev => {
      if (basemaps.find(b => b.id === prev)) return prev;
      return basemaps[0]?.id;
    });
  }, [basemaps]);

  // Route proxied WMTS sources through the server proxy so the preview matches
  // what published viewers get (tiles via /api/proxy, auth attached server-side).
  const previewSources = useMemo(() => proxifyWmtsSources(sources), [sources]);
  const sourceUrlMap = useMemo(() => buildSourceUrlMap(previewSources), [previewSources]);
  const transformRequest = useHeaderAuthTransformRequest(previewSources);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    const timers = debounceTimersRef.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  // Clear prefetch cache when layers or sourceUrlMap change so prefetch re-fires
  useEffect(() => {
    prefetchedRef.current.clear();
  }, [layers, sourceUrlMap]);

  const fetchSuggestions = useCallback(
    (layerId: string, property: string, query: string, options?: { prefetch?: boolean }) => {
      const layer = layers.find(l => l.id === layerId);
      if (!layer) return;
      const sourceInfo = sourceUrlMap[layer.sourceId];
      if (!sourceInfo || sourceInfo.isWmts) return;

      const key = `${layerId}:${property}`;

      if (options?.prefetch) {
        if (prefetchedRef.current.has(key)) return;
        prefetchedRef.current.add(key);
        fetchDistinctValues(sourceInfo.url, layer.collection, property, { fetchAll: true }, sourceInfo.auth)
          .then(values => setAutocompleteSuggestions(prev => ({ ...prev, [key]: values })))
          .catch(() => prefetchedRef.current.delete(key));
        return;
      }

      // Debounced text autocomplete — require at least 2 chars
      const existing = debounceTimersRef.current[key];
      if (existing) clearTimeout(existing);

      if (query.length < 2) return;

      const timer = setTimeout(() => {
        delete debounceTimersRef.current[key];
        fetchDistinctValues(sourceInfo.url, layer.collection, property, { query, limit: 50 }, sourceInfo.auth)
          .then(values => setAutocompleteSuggestions(prev => ({ ...prev, [key]: values })))
          .catch(() => {});
      }, 300);
      debounceTimersRef.current[key] = timer;
    },
    [layers, sourceUrlMap],
  );

  // Apply opacity overrides to layers that have styles
  const [opacityOverrides, setOpacityOverrides] = useState<Record<string, number>>({});
  const layersWithDefaults = useMemo(
    () => layers.map(l => {
      const opacity = opacityOverrides[l.id];
      if (opacity === undefined || !l.styles?.length) return l;
      const opKey: Record<string, string> = { fill: 'fill-opacity', line: 'line-opacity', circle: 'circle-opacity', symbol: 'icon-opacity' };
      return {
        ...l,
        styles: l.styles.map(style => {
          const key = opKey[style.type];
          if (!key) return style;
          return { ...style, paint: { ...style.paint, [key]: opacity } } as typeof style;
        }),
      } as LayerConfig;
    }),
    [layers, opacityOverrides],
  );

  // Reverse so first layer in config (top of list) renders on top of the map
  const reversedLayers = useMemo(() => [...layersWithDefaults].reverse(), [layersWithDefaults]);

  const handleLayerOpacity = useCallback((layerId: string, opacity: number) => {
    setOpacityOverrides(prev => ({ ...prev, [layerId]: opacity }));
  }, []);

  const activeBasemap = basemaps.find(b => b.id === activeBasemapId);
  const mapStyleUrl = activeBasemap?.url ?? basemaps[0]?.url ?? FALLBACK_BASEMAP_URL;

  useEffect(() => {
    if (!sprites?.length) {
      setResolvedStyle(mapStyleUrl);
      return;
    }
    resolveStyleWithSprites(mapStyleUrl, sprites)
      .then(setResolvedStyle)
      .catch((err) => {
        console.warn('Failed to resolve sprite style, using basemap URL:', err);
        setResolvedStyle(mapStyleUrl);
      });
  }, [mapStyleUrl, sprites]);

  const showEmptyState = sources.length === 0 && layers.length === 0;

  const visibleLayerIds = useMemo(() => layers.filter(l => l.visible).map(l => l.id), [layers]);

  const featureInteractionEnabled = uiConfig && (uiConfig.showFeatureDetail || uiConfig.showFeatureTooltip);

  const interactiveLayerIds = useMemo(() => {
    if (!featureInteractionEnabled) return undefined;
    return layers
      .filter(l => l.visible)
      .flatMap(l => getLayerSubLayerIds(l, effectiveCql2Filters[l.id]));
  }, [featureInteractionEnabled, layers, effectiveCql2Filters]);

  const { runExport, loading: exportLoading, progress: exportProgress, error: exportError } = useExport({
    converters: exportConverters,
  });

  const [exportModalOpen, setExportModalOpen] = useState(false);

  const exportableLayers: ExportableLayer[] = useMemo(
    () => layers.filter(l => l.visible).map(l => ({ id: l.id, label: l.label, collection: l.collection })),
    [layers],
  );

  const handleExportRequest = useCallback(
    (request: ExportRequest) => {
      const cql2Filter = request.filtered ? (effectiveCql2Filters[request.layer.id] ?? undefined) : undefined;
      const filename = `${request.layer.label}${request.format.extension}`;
      const layer = layers.find(l => l.id === request.layer.id);
      const source = sources.find(s => s.id === layer?.sourceId);
      const baseUrl = source && isOgcApiSource(source) ? source.url : '';
      runExport(request.layer.collection, request.format.id, filename, cql2Filter, baseUrl);
    },
    [runExport, effectiveCql2Filters, layers, sources],
  );

  const handleFilterChange = useCallback(
    (layerId: string, property: string, value: SearchFilterValue) => {
      setActiveFilters(prev => {
        const current = prev[layerId] ?? {};
        const updated: SearchFilterValues = { ...current, [property]: value };
        const layer = layers.find(l => l.id === layerId);
        const fields = layer?.search?.fields ?? [];
        const structuredCql2 = fromStructuredFilters(updated, fields);
        const customCql2 = propertyFiltersToCql2(propertyFilters, layerId);
        setActiveCql2Filters(cql2Prev => ({ ...cql2Prev, [layerId]: and(structuredCql2, customCql2) ?? undefined }));
        return { ...prev, [layerId]: updated };
      });
    },
    [layers, propertyFilters],
  );

  const handlePropertyFiltersChange = useCallback(
    (filters: PropertyFilter[]) => {
      setPropertyFilters(filters);
      const touched = new Set<string>();
      for (const f of filters) touched.add(f.layerId);
      for (const f of propertyFilters) touched.add(f.layerId);
      for (const layerId of touched) {
        const structured = activeFilters[layerId] ?? {};
        const layer = layers.find(l => l.id === layerId);
        const fields = layer?.search?.fields ?? [];
        const structuredCql2 = fromStructuredFilters(structured, fields);
        const customCql2 = propertyFiltersToCql2(filters, layerId);
        setActiveCql2Filters(prev => ({ ...prev, [layerId]: and(structuredCql2, customCql2) ?? undefined }));
      }
    },
    [propertyFilters, activeFilters, layers],
  );

  const handleClearLayerFilters = useCallback((layerId: string) => {
    setActiveFilters(prev => { const next = { ...prev }; delete next[layerId]; return next; });
    setPropertyFilters(prev => prev.filter(f => f.layerId !== layerId));
    setActiveCql2Filters(prev => { const next = { ...prev }; delete next[layerId]; return next; });
    setSearchHighlightData(null);
  }, []);

  // Adapts zoom instructions to the preview's MapLibre ref (vs the map-client
  // store's flyTo/fitBounds actions).
  const zoomDispatch = useMemo(
    () => ({
      flyTo: (center: [number, number], zoom: number) =>
        mapRef.current?.flyTo({ center, zoom }),
      fitBounds: (bbox: [number, number, number, number], options: { padding: number; maxZoom: number }) =>
        mapRef.current?.fitBounds(bbox, options),
    }),
    [],
  );

  const handleZoomToFeature = useCallback(
    async (layerId: string, property: string, value: string) => {
      const layer = layers.find(l => l.id === layerId);
      if (!layer) return;
      const sourceInfo = sourceUrlMap[layer.sourceId];
      if (!sourceInfo || sourceInfo.isWmts) return;

      // Respect the layer's permanent base filter, then constrain to the
      // triggering field's value. Fetch up to `limit` matches so we can fit
      // them all and highlight the full set.
      const cql2Filter = and(baseCql2FilterFromLayer(layer), eq(property, value)) ?? undefined;
      const data = await fetchFeatures(sourceInfo.url, layer.collection, { cql2Filter, limit: 500 }, sourceInfo.auth);
      if (!data.features.length) return;

      const geometries = data.features.map(
        (f) => f.geometry as unknown as Record<string, unknown> | null | undefined,
      );

      const instruction = zoomToFeature(combineGeometries(geometries), {
        layerMinZoom: layer.minZoom,
        layerMaxZoom: layer.maxZoom,
        pointZoom: layer.zoomToLevel,
      });
      applyZoomInstruction(instruction, zoomDispatch);

      setSearchHighlightData(featureCollectionFromGeometries(geometries));
    },
    [layers, sourceUrlMap, zoomDispatch],
  );

  // ─── Global search: mount-time prefetch of distinct values ──────────────
  // Stable dep key so the sweep only re-fires when the set of prefetched
  // properties itself changes — not on every layer/style edit.
  const globalSearchPrefetchDepKey = useMemo(() => {
    if (!globalSearchEnabled || !globalSearch) return '';
    const pairs: string[] = [];
    for (const l of globalSearch.layers) {
      for (const p of l.properties) {
        if (p.prefetch) pairs.push(prefetchKey(l.layerId, p.property));
      }
    }
    return pairs.sort().join('|');
  }, [globalSearchEnabled, globalSearch]);

  useEffect(() => {
    if (!globalSearchEnabled || !globalSearch || globalSearchPrefetchDepKey === '') return;

    const controller = new AbortController();
    const ctx: GlobalSearchContext = {
      config: globalSearch,
      layers,
      sources: sources.filter(isOgcApiSource),
      prefetchedValues: prefetchedDistinctValues,
    };

    prefetchAllDistinctValues(ctx, controller.signal)
      .then((values) => {
        if (controller.signal.aborted) return;
        setPrefetchedDistinctValues((prev) => ({ ...prev, ...values }));
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        console.warn('[MapPreview] Global search prefetch failed:', err);
      });

    return () => controller.abort();
    // layers/sources are stable post-hydration in the wizard; rerun only when
    // the prefetch-marked property set itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSearchEnabled, globalSearchPrefetchDepKey]);

  // ─── Global search: debounced query → search ────────────────────────────
  useEffect(() => {
    if (!globalSearchEnabled || !globalSearch) return;

    const minLen = globalSearch.minQueryLength;
    const debounceMs = globalSearch.debounceMs;

    if (globalSearchInFlightRef.current) {
      globalSearchInFlightRef.current.abort();
      globalSearchInFlightRef.current = null;
    }
    if (globalSearchDebounceRef.current != null) {
      clearTimeout(globalSearchDebounceRef.current);
      globalSearchDebounceRef.current = null;
    }

    if (globalSearchQuery.length < minLen) {
      setGlobalSearchResults({});
      setGlobalSearchIsLoading(false);
      // Emptying / clearing the search box is a manual clear — drop the highlight.
      setSearchHighlightData(null);
      return;
    }

    globalSearchDebounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      globalSearchInFlightRef.current = controller;
      setGlobalSearchIsLoading(true);

      const ctx: GlobalSearchContext = {
        config: globalSearch,
        layers,
        sources: sources.filter(isOgcApiSource),
        prefetchedValues: prefetchedDistinctValues,
      };

      runGlobalSearch(ctx, globalSearchQuery, controller.signal)
        .then((grouped) => {
          if (controller.signal.aborted) return;
          setGlobalSearchResults(grouped);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          console.warn('[MapPreview] Global search query failed:', err);
          setGlobalSearchResults({});
        })
        .finally(() => {
          if (!controller.signal.aborted) setGlobalSearchIsLoading(false);
          if (globalSearchInFlightRef.current === controller) {
            globalSearchInFlightRef.current = null;
          }
        });
    }, debounceMs);

    return () => {
      if (globalSearchDebounceRef.current != null) {
        clearTimeout(globalSearchDebounceRef.current);
        globalSearchDebounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSearchEnabled, globalSearchQuery, globalSearch, prefetchedDistinctValues]);

  useEffect(() => {
    return () => {
      if (globalSearchInFlightRef.current) {
        globalSearchInFlightRef.current.abort();
        globalSearchInFlightRef.current = null;
      }
    };
  }, []);

  const handleGlobalSearchResultClick = useCallback(
    (layerId: string, match: GlobalSearchFeatureMatch) => {
      const layer = layers.find((l) => l.id === layerId);

      // Zoom to the clicked feature at an appropriate level: points fly to a
      // sensible zoom (layer `zoomToLevel` or the util default), polygons/lines
      // fit their extent. Shared with the SearchPanel path so both match the
      // live map client.
      const instruction = zoomToFeature(
        match.geometry as unknown as Record<string, unknown> | undefined,
        {
          layerMinZoom: layer?.minZoom,
          layerMaxZoom: layer?.maxZoom,
          pointZoom: layer?.zoomToLevel,
        },
      );
      applyZoomInstruction(instruction, zoomDispatch);
      if (!instruction && match.bbox) {
        mapRef.current?.fitBounds(match.bbox, { padding: 50, maxZoom: 16 });
      }

      // Highlight every current match (across all groups), not just the clicked
      // one. Persists until the next search or a manual clear.
      const geometries = Object.values(globalSearchResults).flatMap((group) =>
        group.matches.map(
          (m) => m.geometry as unknown as Record<string, unknown> | undefined,
        ),
      );
      setSearchHighlightData(featureCollectionFromGeometries(geometries));
    },
    [layers, globalSearchResults, zoomDispatch],
  );

  const findLayerForFeature = useCallback((featureLayerId: string) => {
    return layers.find(l => {
      const sourceKey = l.dataMode === 'vector-tiles'
        ? getVectorTileSourceKey(l.id, effectiveCql2Filters[l.id])
        : l.id;
      // Match either the parent source key or any sub-layer ID (sourceKey--type--i)
      return featureLayerId === sourceKey ||
        featureLayerId.startsWith(`${sourceKey}--`);
    });
  }, [layers, effectiveCql2Filters]);

  const handleMapLoad = useCallback(() => {
    setMapInstance(mapRef.current?.getMap() ?? null);
  }, []);

  useEffect(() => {
    if (!mapInstance) return;
    const handler = (e: { id: string }) => {
      console.warn(
        `Missing sprite image: "${e.id}". ` +
        'Ensure a sprite source containing this image is configured in the Basemaps step.'
      );
    };
    mapInstance.on('styleimagemissing', handler);
    return () => { mapInstance.off('styleimagemissing', handler); };
  }, [mapInstance]);

  useEffect(() => {
    if (!mapInstance) return;
    for (const layer of layersWithDefaults) {
      if (!layer.styles?.length) continue;
      const sourceKey = getLayerSourceKey(layer, effectiveCql2Filters[layer.id]);
      layer.styles.forEach((style, i) => {
        // A dashByCategory line style renders as N per-case layers, each with a
        // static line-dasharray — don't overwrite that from the shared paint.
        const isDashExpanded = style.type === 'line' && !!style.dashByCategory && expandDashByCategory(style).length > 0;
        for (const subLayerId of getStyleSubLayerIds(sourceKey, style, i)) {
          if (!mapInstance.getLayer(subLayerId)) continue;
          for (const [prop, value] of Object.entries(style.paint)) {
            if (isDashExpanded && prop === 'line-dasharray') continue;
            try {
              mapInstance.setPaintProperty(subLayerId, prop, value);
            } catch {
              // Layer may not be added yet
            }
          }
        }
      });
    }
  }, [mapInstance, layersWithDefaults, effectiveCql2Filters]);

  // Reorder MapLibre layers to match the desired layersWithDefaults order
  useEffect(() => {
    if (!mapInstance) return;

    const frame = requestAnimationFrame(() => {
      const desiredOrder = reversedLayers
        .filter(l => sourceUrlMap[l.sourceId] && l.styles?.length)
        .flatMap(l => getLayerSubLayerIds(l, effectiveCql2Filters[l.id]))
        .filter(id => mapInstance.getLayer(id));

      // Move each layer before the one above it, from bottom to top
      for (let i = desiredOrder.length - 2; i >= 0; i--) {
        try {
          mapInstance.moveLayer(desiredOrder[i], desiredOrder[i + 1]);
        } catch {
          // Layer may not be on the map yet
        }
      }

      // Move imagery layers below all feature layers
      const firstFeatureId = desiredOrder[0];
      if (firstFeatureId) {
        for (const id of imageryLayerIds) {
          const imgLayerId = `imagery-${id}`;
          if (mapInstance.getLayer(imgLayerId)) {
            try {
              mapInstance.moveLayer(imgLayerId, firstFeatureId);
            } catch { /* layer may not be on map yet */ }
          }
        }
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [mapInstance, reversedLayers, sourceUrlMap, effectiveCql2Filters, imageryLayerIds]);

  const handleMove = (evt: { viewState: { latitude: number; longitude: number; zoom: number; pitch: number; bearing: number } }) => {
    const next: ViewConfig = {
      latitude: evt.viewState.latitude,
      longitude: evt.viewState.longitude,
      zoom: evt.viewState.zoom,
      pitch: evt.viewState.pitch,
      bearing: evt.viewState.bearing,
      ...(internalViewState.minZoom != null ? { minZoom: internalViewState.minZoom } : {}),
      ...(internalViewState.maxZoom != null ? { maxZoom: internalViewState.maxZoom } : {}),
    };
    if (onViewStateChange) {
      onViewStateChange(next);
    } else {
      setInternalViewState(next);
    }
  };

  // Only forward zoom constraints when the min/max pair is coherent. Invalid
  // intermediate states (e.g. user mid-typing) would otherwise throw in MapLibre.
  const zoomConstraintsValid =
    internalViewState.minZoom == null ||
    internalViewState.maxZoom == null ||
    internalViewState.minZoom <= internalViewState.maxZoom;

  return (
    <div className="mapui:relative mapui:w-full mapui:h-full mapui:overflow-hidden mapui:overscroll-contain">
      <Map
        ref={mapRef}
        latitude={internalViewState.latitude}
        longitude={internalViewState.longitude}
        zoom={internalViewState.zoom}
        pitch={internalViewState.pitch}
        bearing={internalViewState.bearing}
        {...(zoomConstraintsValid && internalViewState.minZoom != null ? { minZoom: internalViewState.minZoom } : {})}
        {...(zoomConstraintsValid && internalViewState.maxZoom != null ? { maxZoom: internalViewState.maxZoom } : {})}
        style={{ width: '100%', height: '100%' }}
        mapStyle={resolvedStyle as any}
        transformRequest={transformRequest}
        cursor={pinDropActive || measure.mode || selection.mode ? 'crosshair' : cursor}
        interactiveLayerIds={pinDropActive || measure.mode || selection.mode === 'box' || selection.mode === 'polygon' ? undefined : interactiveLayerIds}
        doubleClickZoom={!pinDropActive && !measure.mode && !selection.mode}
        onLoad={handleMapLoad}
        onMove={handleMove}
        onClick={(evt) => {
          if (pinDropActive) {
            goToCoordinate(evt.lngLat.lat, evt.lngLat.lng);
            setPinDropActive(false);
            return;
          }
          if (measure.mode) {
            measure.addPoint([evt.lngLat.lng, evt.lngLat.lat]);
            return;
          }
          if (selection.mode === 'polygon') {
            polygonDraw.addPoint([evt.lngLat.lng, evt.lngLat.lat]);
            return;
          }
          if (selection.mode === 'click') {
            const allFeatures = evt.features ?? [];
            // Filter to only features from the active selection layer
            const sourceKey = selection.activeLayerId
              ? getVectorTileSourceKey(selection.activeLayerId, effectiveCql2Filters[selection.activeLayerId])
              : null;
            const selFeatures = sourceKey
              ? allFeatures.filter((f) => f.layer.id.startsWith(`${sourceKey}--`))
              : allFeatures;
            if (selFeatures.length > 0 && selection.activeLayerId) {
              const activeLayer = layers.find((l) => l.id === selection.activeLayerId);
              const activeSourceInfo = activeLayer ? sourceUrlMap[activeLayer.sourceId] : null;
              if (activeLayer && activeSourceInfo && activeLayer.dataMode === 'vector-tiles') {
                // Fetch full geometry from OGC API for vector tile features
                const tileFeatures = selFeatures.map((f) => ({
                  id: f.id,
                  layerId: selection.activeLayerId!,
                  properties: (f.properties ?? {}) as Record<string, unknown>,
                  geometry: f.geometry as unknown as Record<string, unknown>,
                }));
                Promise.allSettled(
                  selFeatures.map(async (f) => {
                    const featureId = (f.properties as Record<string, unknown>)?.gid ?? f.id;
                    if (featureId != null) {
                      const full = await fetchFeatureById(activeSourceInfo.url, activeLayer.collection, featureId as string | number);
                      if (full) {
                        return { id: f.id, layerId: selection.activeLayerId!, properties: (full.properties ?? {}) as Record<string, unknown>, geometry: full.geometry as unknown as Record<string, unknown> };
                      }
                    }
                    return { id: f.id, layerId: selection.activeLayerId!, properties: (f.properties ?? {}) as Record<string, unknown>, geometry: f.geometry as unknown as Record<string, unknown> };
                  }),
                ).then((results) => {
                  const resolved = results.map((r, i) => r.status === 'fulfilled' ? r.value : tileFeatures[i]);
                  selection.addFeatures(resolved);
                });
              } else {
                selection.addFeatures(
                  selFeatures.map((f) => ({
                    id: f.id,
                    layerId: selection.activeLayerId!,
                    properties: (f.properties ?? {}) as Record<string, unknown>,
                    geometry: f.geometry as unknown as Record<string, unknown>,
                  })),
                );
              }
            }
            return;
          }
          if (!featureInteractionEnabled) return;
          const features = evt.features ?? [];
          if (features.length > 0) {
            const seen = new Set<string>();
            const infos: typeof selectedFeatures = [];
            for (const f of features) {
              const layer = findLayerForFeature(f.layer.id);
              if (layer?.showDetailPanel === false) continue;
              const layerId = layer?.id ?? f.layer.id;
              if (seen.has(layerId)) continue;
              seen.add(layerId);
              const resolved = resolvePropertyDisplay(layer?.propertyDisplay);
              infos.push({
                properties: (f.properties ?? {}) as Record<string, unknown>,
                title: layer?.label ?? (f.properties?.['name'] as string) ?? f.layer.id,
                fields: resolved?.fields,
                labels: resolved?.labels,
              });
            }
            setSelectedFeatures(infos);
          }
        }}
        onDblClick={(evt) => {
          if (measure.mode) {
            evt.preventDefault();
            return;
          }
          if (selection.mode === 'polygon') {
            evt.preventDefault();
            polygonDraw.complete();
          }
        }}
        onMouseMove={(evt) => {
          setMouseCoords({ latitude: evt.lngLat.lat, longitude: evt.lngLat.lng });
          if (!featureInteractionEnabled || selection.mode) return;
          clearTimeout(hoverTimerRef.current);
          const features = evt.features ?? [];
          if (features.length > 0) {
            setCursor('pointer');
            const point = { x: evt.point.x, y: evt.point.y };
            hoverTimerRef.current = setTimeout(() => {
              const seen = new Set<string>();
              const infos: typeof hoveredFeatures = [];
              for (const f of features) {
                const layer = findLayerForFeature(f.layer.id);
                if (layer?.showTooltip === false) continue;
                const layerId = layer?.id ?? f.layer.id;
                if (seen.has(layerId)) continue;
                seen.add(layerId);
                const resolved = resolvePropertyDisplay(layer?.propertyDisplay);
                infos.push({
                  properties: (f.properties ?? {}) as Record<string, unknown>,
                  title: layer?.label ?? (f.properties?.['name'] as string),
                  fields: resolved?.fields,
                  labels: resolved?.labels,
                });
              }
              setHoveredFeatures(infos);
              setHoveredPoint(point);
            }, 1000);
          } else {
            setCursor('auto');
            setHoveredFeatures([]);
            setHoveredPoint(null);
          }
        }}
        onMouseOut={() => {
          clearTimeout(hoverTimerRef.current);
          setCursor('auto');
          setMouseCoords(null);
          setHoveredFeatures([]);
          setHoveredPoint(null);
        }}
        attributionControl={false}
      >
        <AttributionControl position="bottom-left" />

        {/* Render raster imagery layers (above basemap, below features) */}
        {!showEmptyState && imageryLayers.map((layer) => {
          const sourceInfo = sourceUrlMap[layer.sourceId];
          if (!sourceInfo && !layer.tileUrlTemplate) return null;
          return (
            <PreviewRasterImageryLayer
              key={layer.id}
              layer={layer}
              sourceUrl={sourceInfo?.url ?? ''}
              tileMatrixSetId={sourceInfo?.tileMatrixSetId}
              auth={sourceInfo?.auth}
              sourceTileUrlTemplate={sourceInfo?.tileUrlTemplate}
            />
          );
        })}

        {!showEmptyState && reversedLayers.map((layer) => {
          const sourceInfo = sourceUrlMap[layer.sourceId];
          if (!sourceInfo || !layer.styles?.length) return null;
          if (sourceInfo.isWmts) return null;

          if (layer.dataMode === 'geojson') {
            return (
              <PreviewGeoJsonLayer
                key={layer.id}
                layer={layer}
                sourceUrl={sourceInfo.url}
                cql2Filter={effectiveCql2Filters[layer.id]}
                auth={sourceInfo.auth}
              />
            );
          }

          return (
            <PreviewVectorTileLayer
              key={getVectorTileSourceKey(layer.id, effectiveCql2Filters[layer.id])}
              layer={layer}
              sourceUrl={sourceInfo.url}
              tileMatrixSetId={sourceInfo.tileMatrixSetId}
              cql2Filter={effectiveCql2Filters[layer.id]}
              auth={sourceInfo.auth}
            />
          );
        })}

        {/* Measure tool GeoJSON */}
        {measure.geometryData && (
          <Source id="measure-geometry" type="geojson" data={measure.geometryData}>
            <Layer
              id="measure-line-layer"
              type="line"
              paint={{ 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [2, 2] }}
            />
            {measure.mode === 'area' && measure.points.length >= 3 && (
              <Layer
                id="measure-fill-layer"
                type="fill"
                paint={{ 'fill-color': '#3b82f6', 'fill-opacity': 0.1 }}
              />
            )}
          </Source>
        )}
        {measure.pointsData && (
          <Source id="measure-points" type="geojson" data={measure.pointsData}>
            <Layer
              id="measure-points-layer"
              type="circle"
              paint={{ 'circle-color': '#3b82f6', 'circle-radius': 5, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }}
            />
          </Source>
        )}

        {/* Selection highlight */}
        {selection.highlightData && (
          <Source id="selection-highlight" type="geojson" data={selection.highlightData}>
            <Layer id="selection-highlight-fill" type="fill"
              paint={{ 'fill-color': '#fbbf24', 'fill-opacity': 0.3 }}
              filter={['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]] as any} />
            <Layer id="selection-highlight-line" type="line"
              paint={{ 'line-color': '#f59e0b', 'line-width': 3 }} />
            <Layer id="selection-highlight-circle" type="circle"
              paint={{ 'circle-color': '#fbbf24', 'circle-radius': 6, 'circle-stroke-color': '#f59e0b', 'circle-stroke-width': 2 }}
              filter={['==', ['geometry-type'], 'Point'] as any} />
          </Source>
        )}

        {/* Query results highlight */}
        {queryHighlightData && (
          <Source id="query-highlight" type="geojson" data={queryHighlightData as any}>
            <Layer id="query-highlight-fill" type="fill"
              paint={{ 'fill-color': '#3b82f6', 'fill-opacity': 0.25 }}
              filter={['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]] as any} />
            <Layer id="query-highlight-line" type="line"
              paint={{ 'line-color': '#3b82f6', 'line-width': 2 }} />
            <Layer id="query-highlight-circle" type="circle"
              paint={{ 'circle-color': '#3b82f6', 'circle-radius': 5, 'circle-stroke-color': '#2563eb', 'circle-stroke-width': 2 }}
              filter={['==', ['geometry-type'], 'Point'] as any} />
          </Source>
        )}

        {/* Search match highlight — rendered on top of the other highlights */}
        {searchHighlightData && (
          <Source id="search-highlight" type="geojson" data={searchHighlightData}>
            <Layer id="search-highlight-fill" type="fill"
              paint={{ 'fill-color': '#f0abfc', 'fill-opacity': 0.35 }}
              filter={['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]] as any} />
            <Layer id="search-highlight-line" type="line"
              paint={{ 'line-color': '#d946ef', 'line-width': 3 }} />
            <Layer id="search-highlight-circle" type="circle"
              paint={{ 'circle-color': '#f0abfc', 'circle-radius': 7, 'circle-stroke-color': '#d946ef', 'circle-stroke-width': 2.5 }}
              filter={['==', ['geometry-type'], 'Point'] as any} />
          </Source>
        )}

        {/* Box draw preview */}
        {boxDrawData && (
          <Source id="box-draw-preview" type="geojson" data={boxDrawData}>
            <Layer id="box-draw-fill" type="fill"
              paint={{ 'fill-color': '#3b82f6', 'fill-opacity': 0.15 }} />
            <Layer id="box-draw-line" type="line"
              paint={{ 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [3, 3] }} />
          </Source>
        )}

        {/* Polygon draw preview */}
        {polygonDraw.polygonDrawData && (
          <Source id="polygon-draw-preview" type="geojson" data={polygonDraw.polygonDrawData}>
            <Layer id="polygon-draw-fill" type="fill"
              paint={{ 'fill-color': '#3b82f6', 'fill-opacity': 0.15 }} />
            <Layer id="polygon-draw-line" type="line"
              paint={{ 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [3, 3] }} />
          </Source>
        )}
        {polygonDraw.polygonDrawPointsData && (
          <Source id="polygon-draw-points" type="geojson" data={polygonDraw.polygonDrawPointsData}>
            <Layer id="polygon-draw-points-layer" type="circle"
              paint={{ 'circle-color': '#3b82f6', 'circle-radius': 5, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }} />
          </Source>
        )}
        {droppedPin && (
          <Marker
            longitude={droppedPin.longitude}
            latitude={droppedPin.latitude}
            anchor="bottom"
            color="#3b82f6"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setDroppedPin(null);
            }}
          />
        )}
      </Map>

      <ResultsDrawer
        open={resultsOpen}
        tabs={resultsTabs}
        activeTabId={resultsActiveTab}
        onTabChange={setResultsActiveTab}
        onClose={() => setResultsOpen(false)}
      />

      {/* Full overlay when uiConfig is provided */}
      {uiConfig && (
        <div className="mapui:absolute mapui:inset-0 mapui:pointer-events-none">
          {/* Tooltip: follows cursor. Hidden when a detail panel is open. */}
          {uiConfig.showFeatureTooltip && hoveredFeatures.length > 0 && hoveredPoint && selectedFeatures.length === 0 && (
            <div
              className="mapui:absolute mapui:z-20"
              style={{ left: hoveredPoint.x + 12, top: hoveredPoint.y + 12 }}
            >
              <FeatureTooltip features={hoveredFeatures} />
            </div>
          )}

          {/* Top-left: Feature detail panels */}
          {uiConfig.showFeatureDetail && selectedFeatures.length > 0 && (
            <div className="mapui:absolute mapui:top-4 mapui:left-4 mapui:pointer-events-auto mapui:z-10 mapui:flex mapui:flex-col mapui:gap-2 mapui:max-h-[calc(100vh-4rem)] mapui:overflow-y-auto">
              {selectedFeatures.map((feature, i) => (
                <FeatureDetailPanel
                  key={i}
                  isOpen
                  onClose={() => setSelectedFeatures((prev) => prev.filter((_, j) => j !== i))}
                  properties={feature.properties}
                  title={feature.title ?? 'Feature Properties'}
                  fields={feature.fields}
                  labels={feature.labels}
                  variant="panel"
                />
              ))}
            </div>
          )}

          {/* Side-menu layout: legend top-left, hamburger + compass + info top-right, panel slides in */}
          {effectiveLayout === 'side-menu' && (() => {
            const iconFor = (k: OrderableControlKey, fallback: typeof LuSearch) =>
              getControlIcon(uiConfig.controlIcons?.[k], fallback);
            const items: SideMenuPanelItem[] = [];
            if (uiConfig.showLegend) {
              items.push({
                key: 'legend',
                label: 'Legend',
                icon: iconFor('showLegend', LuList),
                content: (
                  <Legend
                    layers={layersWithDefaults}
                    visibleLayerIds={visibleLayerIds}
                    legendOrder={uiConfig.legendOrder}
                    display={uiConfig.legendDisplay}
                    onOpacityChange={uiConfig.showLegendOpacity ? handleLayerOpacity : undefined}
                  />
                ),
                defaultExpanded: true,
              });
            }
            if (uiConfig.showSearchPanel) {
              items.push({
                key: 'search',
                label: 'Search',
                icon: iconFor('showSearchPanel', LuSearch),
                content: (
                  <SearchPanel
                    layers={layersWithDefaults}
                    activeFilters={activeFilters}
                    onFilterChange={handleFilterChange}
                    onClearFilters={handleClearLayerFilters}
                    onZoomToFeature={handleZoomToFeature}
                    autocompleteSuggestions={autocompleteSuggestions}
                    onFetchSuggestions={fetchSuggestions}
                    availableProperties={queryablesByLayer}
                    className="p-3 max-w-xs"
                    hideTitle
                  />
                ),
              });
            }
            if (uiConfig.showLayerPanel) {
              items.push({
                key: 'layers',
                label: 'Layers',
                icon: iconFor('showLayerPanel', LuLayers3),
                content: (
                  <LayerPanel
                    layers={layersWithDefaults}
                    activeLayerIds={visibleLayerIds}
                    onToggleVisibility={(layerId) => {
                      onLayersChange?.(layers.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
                    }}
                    onReorder={(layerIds) => {
                      const layerById: Record<string, LayerConfig> = Object.fromEntries(layers.map(l => [l.id, l]));
                      const reordered = layerIds.map(id => layerById[id]).filter((l): l is LayerConfig => !!l);
                      onLayersChange?.(reordered);
                    }}
                    hideTitle
                  />
                ),
              });
            }
            if (uiConfig.showMeasureTool) {
              items.push({
                key: 'measure',
                label: 'Measure',
                icon: iconFor('showMeasureTool', LuRuler),
                content: (
                  <MeasurePanel
                    mode={measure.mode}
                    onModeChange={measure.setMode}
                    points={measure.points}
                    measurement={measure.measurement}
                    unit={measure.unit}
                    onUnitChange={measure.setUnit}
                    onClear={measure.clear}
                    className="mapui:p-3 mapui:max-w-xs"
                  />
                ),
              });
            }
            if (uiConfig.showSelectionTool) {
              items.push({
                key: 'selection',
                label: 'Select',
                icon: iconFor('showSelectionTool', LuMousePointer2),
                content: (
                  <SelectionPanel
                    mode={selection.mode}
                    onModeChange={selection.setMode}
                    layers={layersWithDefaults}
                    activeLayerId={selection.activeLayerId}
                    onActiveLayerChange={selection.setActiveLayerId}
                    selectedCount={selection.features.length}
                    onClear={selection.clearFeatures}
                    onViewResults={() => setResultsOpen(true)}
                    queryPanel={activeLayer?.cql2Filter ? (
                      <>
                        <QueryPanel
                          cql2Filter={activeLayer.cql2Filter as Cql2FilterConfig}
                          onRun={handleRunQuery}
                          loading={queryLoading}
                          hasSelectionGeometry={selection.features.length > 0}
                        />
                        {queryError && (
                          <p className="mapui:m-0 mapui:text-xs mapui:text-red-600 mapui:mt-1">{queryError}</p>
                        )}
                      </>
                    ) : undefined}
                    className="mapui:p-3 mapui:max-w-xs"
                  />
                ),
              });
            }
            if (uiConfig.showImageryPanel && imageryLayers.length > 0) {
              items.push({
                key: 'imagery',
                label: 'Imagery',
                icon: iconFor('showImageryPanel', LuSatellite),
                content: (
                  <ImageryPanel
                    imageryLayers={imageryLayers}
                    onToggleVisibility={handleToggleImageryVisibility}
                    onOpacityChange={handleImageryOpacity}
                    hideTitle
                    className="mapui:p-3 mapui:max-w-xs"
                  />
                ),
              });
            }
            if (uiConfig.showBasemapSwitcher) {
              items.push({
                key: 'basemap',
                label: 'Basemap',
                icon: iconFor('showBasemapSwitcher', LuMap),
                content: (
                  <BasemapSwitcher
                    basemaps={basemaps}
                    activeBasemapId={activeBasemapId ?? ''}
                    onSelect={setActiveBasemapId}
                  />
                ),
              });
            }
            if (uiConfig.showExportButton || uiConfig.showExportPdf) {
              items.push({
                key: 'export',
                label: 'Export',
                icon: iconFor('showExportButton', LuDownload),
                content: (
                  <ExportButton
                    icon={LuDownload}
                    onExport={() => setExportModalOpen(true)}
                    loading={exportLoading}
                  />
                ),
              });
            }
            return (
              <>
                <div className={`${CORNER_CLASSES[uiConfig.sideMenuToggleCorner ?? 'top-right']} mapui:pointer-events-auto`}>
                  <SideMenuToggle onClick={() => setSideMenuOpen(true)} label="Open menu" />
                  {uiConfig.showCompass && (
                    <CompassControl
                      bearing={internalViewState.bearing}
                      onReset={() => mapRef.current?.easeTo({ bearing: 0, duration: 300 })}
                    />
                  )}
                  {info?.enabled && info.position === 'top-right' && (
                    <InfoControl onClick={() => setInfoModalOpen(true)} />
                  )}
                </div>
                <SideMenuPanel
                  controls={items}
                  isOpen={sideMenuOpen}
                  onClose={() => setSideMenuOpen(false)}
                />
              </>
            );
          })()}

          {/* Controls positioned by corner, order driven by config */}
          {effectiveLayout === 'individual' && (() => {
              const controlNodes: Record<OrderableControlKey, React.ReactNode> = {
                showLegend: uiConfig.showLegend ? (
                  <div className="mapui:pointer-events-auto">
                    <Legend layers={layersWithDefaults} visibleLayerIds={visibleLayerIds} legendOrder={uiConfig.legendOrder} display={uiConfig.legendDisplay} onOpacityChange={uiConfig.showLegendOpacity ? handleLayerOpacity : undefined} />
                  </div>
                ) : null,

                showSearchPanel: uiConfig.showSearchPanel ? (
                  <div className="mapui:pointer-events-auto">
                    <CollapsibleControl
                      icon={LuSearch}
                      label="Search"
                      corner={resolveControlCorner(uiConfig, 'showSearchPanel')}
                      collapsed={openControl !== 'search'}
                      onToggle={(collapsed) => setOpenControl(collapsed ? null : 'search')}
                    >
                      <SearchPanel
                        layers={layersWithDefaults}
                        activeFilters={activeFilters}
                        onFilterChange={handleFilterChange}
                        onClearFilters={handleClearLayerFilters}
                        onZoomToFeature={handleZoomToFeature}
                        autocompleteSuggestions={autocompleteSuggestions}
                        onFetchSuggestions={fetchSuggestions}
                        expandable
                        expanded={searchExpanded}
                        onExpandedChange={setSearchExpanded}
                        availableProperties={queryablesByLayer}
                        propertyFilters={propertyFilters}
                        onPropertyFiltersChange={handlePropertyFiltersChange}
                        className="p-3 max-w-xs"
                        hideTitle
                      />
                    </CollapsibleControl>
                  </div>
                ) : null,

                showLayerPanel: uiConfig.showLayerPanel ? (
                  <div className="mapui:pointer-events-auto">
                    <CollapsibleControl
                      icon={LuLayers3}
                      label="Layers"
                      corner={resolveControlCorner(uiConfig, 'showLayerPanel')}
                      collapsed={openControl !== 'layers'}
                      onToggle={(collapsed) => setOpenControl(collapsed ? null : 'layers')}
                    >
                      <LayerPanel
                        layers={layersWithDefaults}
                        activeLayerIds={visibleLayerIds}
                        onToggleVisibility={(layerId) => {
                          onLayersChange?.(layers.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
                        }}
                        onReorder={(layerIds) => {
                          const layerById: Record<string, LayerConfig> = Object.fromEntries(layers.map(l => [l.id, l]));
                          const reordered = layerIds.map(id => layerById[id]).filter((l): l is LayerConfig => !!l);
                          onLayersChange?.(reordered);
                        }}
                        hideTitle
                      />
                    </CollapsibleControl>
                  </div>
                ) : null,

                showMeasureTool: uiConfig.showMeasureTool ? (
                  <div className="mapui:pointer-events-auto">
                    <CollapsibleControl
                      icon={LuRuler}
                      label="Measure"
                      corner={resolveControlCorner(uiConfig, 'showMeasureTool')}
                      collapsed={openControl !== 'measure'}
                      onToggle={(collapsed) => {
                        setOpenControl(collapsed ? null : 'measure');
                        if (collapsed) {
                          measure.setMode(null);
                        }
                      }}
                    >
                      <MeasurePanel
                        mode={measure.mode}
                        onModeChange={measure.setMode}
                        points={measure.points}
                        measurement={measure.measurement}
                        unit={measure.unit}
                        onUnitChange={measure.setUnit}
                        onClear={measure.clear}
                        className="mapui:p-3 mapui:max-w-xs"
                      />
                    </CollapsibleControl>
                  </div>
                ) : null,

                showSelectionTool: uiConfig.showSelectionTool ? (
                  <div className="mapui:pointer-events-auto">
                    <CollapsibleControl
                      icon={LuMousePointer2}
                      label="Select"
                      corner={resolveControlCorner(uiConfig, 'showSelectionTool')}
                      collapsed={openControl !== 'selection'}
                      onToggle={(collapsed) => {
                        setOpenControl(collapsed ? null : 'selection');
                        if (collapsed) {
                          selection.setMode(null);
                        }
                      }}
                    >
                      <SelectionPanel
                        mode={selection.mode}
                        onModeChange={selection.setMode}
                        layers={layersWithDefaults}
                        activeLayerId={selection.activeLayerId}
                        onActiveLayerChange={selection.setActiveLayerId}
                        selectedCount={selection.features.length}
                        onClear={selection.clearFeatures}
                        onViewResults={() => setResultsOpen(true)}
                        queryPanel={activeLayer?.cql2Filter ? (
                          <>
                            <QueryPanel
                              cql2Filter={activeLayer.cql2Filter as Cql2FilterConfig}
                              onRun={handleRunQuery}
                              loading={queryLoading}
                              hasSelectionGeometry={selection.features.length > 0}
                            />
                            {queryError && (
                              <p className="mapui:m-0 mapui:text-xs mapui:text-red-600 mapui:mt-1">{queryError}</p>
                            )}
                          </>
                        ) : undefined}
                        className="mapui:p-3 mapui:max-w-xs"
                      />
                    </CollapsibleControl>
                  </div>
                ) : null,

                showImageryPanel: uiConfig.showImageryPanel && imageryLayers.length > 0 ? (
                  <div className="mapui:pointer-events-auto">
                    <CollapsibleControl
                      icon={LuSatellite}
                      label="Imagery"
                      corner={resolveControlCorner(uiConfig, 'showImageryPanel')}
                      collapsed={openControl !== 'imagery'}
                      onToggle={(collapsed) => setOpenControl(collapsed ? null : 'imagery')}
                    >
                      <ImageryPanel
                        imageryLayers={imageryLayers}
                        onToggleVisibility={handleToggleImageryVisibility}
                        onOpacityChange={handleImageryOpacity}
                        hideTitle
                        className="mapui:p-3 mapui:max-w-xs"
                      />
                    </CollapsibleControl>
                  </div>
                ) : null,

                showBasemapSwitcher: uiConfig.showBasemapSwitcher ? (
                  <div className="mapui:pointer-events-auto">
                    <CollapsibleControl
                      icon={LuMap}
                      label="Basemap"
                      corner={resolveControlCorner(uiConfig, 'showBasemapSwitcher')}
                      collapsed={openControl !== 'basemap'}
                      onToggle={(collapsed) => setOpenControl(collapsed ? null : 'basemap')}
                    >
                      <BasemapSwitcher
                        basemaps={basemaps}
                        activeBasemapId={activeBasemapId ?? ''}
                        onSelect={setActiveBasemapId}
                      />
                    </CollapsibleControl>
                  </div>
                ) : null,

                showExportButton: (uiConfig.showExportButton || uiConfig.showExportPdf) ? (
                  <div className="mapui:pointer-events-auto">
                    <ExportButton
                      icon={LuDownload}
                      onExport={() => setExportModalOpen(true)}
                      loading={exportLoading}
                    />
                  </div>
                ) : null,

                showCompass: uiConfig.showCompass ? (
                  <div className="mapui:pointer-events-auto">
                    <CompassControl
                      bearing={internalViewState.bearing}
                      onReset={() => mapRef.current?.easeTo({ bearing: 0, duration: 300 })}
                    />
                  </div>
                ) : null,

                showInfoControl: info?.enabled && info.position === 'top-right' ? (
                  <div className="mapui:pointer-events-auto">
                    <InfoControl onClick={() => setInfoModalOpen(true)} />
                  </div>
                ) : null,
              };

              const grouped = groupControlsByCorner(uiConfig);
              const searchPos = globalSearch?.position ?? DEFAULT_GLOBAL_SEARCH_POSITION;
              const searchWidth = globalSearch?.width ?? DEFAULT_GLOBAL_SEARCH_WIDTH;
              const searchAtCorner =
                globalSearchEnabled && globalSearch && isGlobalSearchCorner(searchPos)
                  ? searchPos
                  : null;
              return CONTROL_CORNERS.map((corner) => {
                const keys = grouped[corner];
                const rendered = keys
                  .map((key) => controlNodes[key])
                  .filter((node): node is React.ReactNode => node != null);
                const includeSearch = searchAtCorner === corner;
                if (rendered.length === 0 && !includeSearch) return null;
                return (
                  <div key={corner} className={CORNER_CLASSES[corner]}>
                    {includeSearch && globalSearch && (
                      <div
                        className={`mapui:pointer-events-auto ${globalSearchWidthClass(searchWidth, 'mapui:')}`}
                        data-testid="map-preview-global-search"
                      >
                        <GlobalSearchBar
                          config={globalSearch}
                          layers={layersWithDefaults}
                          value={globalSearchQuery}
                          onChange={setGlobalSearchQuery}
                          results={globalSearchResults}
                          onResultClick={handleGlobalSearchResultClick}
                          isLoading={globalSearchIsLoading}
                          className="mapui:shadow-lg"
                        />
                      </div>
                    )}
                    {keys.map((key) => {
                      const node = controlNodes[key];
                      return node ? <Fragment key={key}>{node}</Fragment> : null;
                    })}
                  </div>
                );
              });
          })()}

          {/* Export modal */}
          <div className="mapui:pointer-events-auto">
            <ExportModal
              open={exportModalOpen}
              layers={exportableLayers}
              availableFormats={DEFAULT_EXPORT_FORMATS}
              hasActiveFilter={(layerId) => effectiveCql2Filters[layerId] != null}
              loading={exportLoading}
              progress={exportProgress}
              error={exportError?.message}
              onExport={handleExportRequest}
              onClose={() => setExportModalOpen(false)}
            />
          </div>

          {/* Bottom-center: Coordinate display */}
          {uiConfig.showCoordinateDisplay && (
            <div className="mapui:absolute mapui:bottom-0 mapui:left-1/2 mapui:-translate-x-1/2 mapui:pointer-events-auto">
              <CoordinateDisplay
                latitude={mouseCoords?.latitude ?? null}
                longitude={mouseCoords?.longitude ?? null}
                activeFormat={coordFormat}
                formats={coordinateFormats}
                onFormatChange={setCoordFormat}
                onNavigate={goToCoordinate}
                onPinDropRequest={() => setPinDropActive((v) => !v)}
                pinDropActive={pinDropActive}
              />
            </div>
          )}
        </div>
      )}

      {/* Standalone info control: rendered for non-top-right corners, or when uiConfig
          is absent (legacy mode) — top-right with uiConfig is rendered inside controlNodes. */}
      {info?.enabled && (info.position !== 'top-right' || !uiConfig) && (
        <div className={INFO_CORNER_CLASSES[info.position]}>
          <InfoControl onClick={() => setInfoModalOpen(true)} />
        </div>
      )}

      {info?.enabled && (
        <InfoModal
          open={infoModalOpen}
          title={info.title}
          markdown={info.markdown ?? ''}
          onClose={() => setInfoModalOpen(false)}
        />
      )}

      {/* Legacy overlay when uiConfig is not provided */}
      {!showEmptyState && !uiConfig && (
        <div className="mapui:absolute mapui:top-2 mapui:right-2 mapui:flex mapui:flex-col mapui:gap-2 mapui:max-w-[280px]">
          <Legend
            layers={layersWithDefaults}
            visibleLayerIds={visibleLayerIds}
          />
          <div className="mapui:rounded-lg mapui:bg-white mapui:p-3 mapui:shadow-md mapui:text-sm">
            <LayerPanel
              layers={layersWithDefaults}
              activeLayerIds={visibleLayerIds}
              onToggleVisibility={(layerId) => {
                onLayersChange?.(layers.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
              }}
              hideTitle
            />
          </div>
        </div>
      )}

      {showEmptyState && (
        <div className="mapui:absolute mapui:inset-0 mapui:flex mapui:items-center mapui:justify-center mapui:pointer-events-none">
          <div className="mapui:bg-white/80 mapui:backdrop-blur-sm mapui:rounded-lg mapui:px-4 mapui:py-3 mapui:text-sm mapui:text-slate-600 mapui:shadow mapui:text-center mapui:max-w-[200px]">
            Configure sources and layers to see a preview
          </div>
        </div>
      )}

      {currentStep === 'view' && (
        <div className="mapui:absolute mapui:top-2 mapui:left-1/2 mapui:-translate-x-1/2 mapui:pointer-events-none">
          <div className="mapui:bg-blue-600/90 mapui:text-white mapui:text-xs mapui:rounded-full mapui:px-3 mapui:py-1 mapui:shadow">
            Pan and zoom to set the initial viewport
          </div>
        </div>
      )}

      {/* Global search.
          - effectiveLayout 'individual' + corner position: injected into the
            corner-stack flex column above (so it stacks with other controls).
          - All other cases (center positions, side-menu layout, no uiConfig):
            standalone absolute wrapper. */}
      {(() => {
        if (!globalSearchEnabled || !globalSearch) return null;
        const pos = globalSearch.position ?? DEFAULT_GLOBAL_SEARCH_POSITION;
        const width = globalSearch.width ?? DEFAULT_GLOBAL_SEARCH_WIDTH;
        // When uiConfig + individual layout + corner position, the corner
        // stack above already rendered the bar — skip here to avoid a duplicate.
        if (uiConfig && effectiveLayout === 'individual' && isGlobalSearchCorner(pos)) return null;
        return (
          <div
            className={`${globalSearchPositionClass(pos, 'mapui:')} mapui:z-40 mapui:pointer-events-none`}
            data-testid="map-preview-global-search"
          >
            <div className={`mapui:pointer-events-auto ${globalSearchWidthClass(width, 'mapui:')}`}>
              <GlobalSearchBar
                config={globalSearch}
                layers={layersWithDefaults}
                value={globalSearchQuery}
                onChange={setGlobalSearchQuery}
                results={globalSearchResults}
                onResultClick={handleGlobalSearchResultClick}
                isLoading={globalSearchIsLoading}
                className="mapui:shadow-lg"
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
