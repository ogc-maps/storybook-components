import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LayerList,
  ImageryList,
  isImageryLayerIncomplete,
  CollectionBrowser,
  BasemapList,
  SpriteSourceList,
  UIConfigEditor,
  GlobalSearchConfigEditor,
  ViewEditor,
  ConfigReview,
  CollapsibleSection,
  FormField,
  ColorPicker,
  resolveAvailableIcons,
  slugify,
  INFO_POSITIONS,
} from '@ogc-maps/storybook-components';
import { safeValidateMapConfig, DEFAULT_HEADER_COLOR } from '@ogc-maps/storybook-components/schemas';
import { detectTileSourceType, isOgcApiSource, isImagerySource } from '@ogc-maps/storybook-components/utils';
import { savedSourceToWmts } from '../utils/wmtsSource';
import type {
  OgcApiSource,
  WmtsSource,
  MapSource,
  LayerConfig,
  ImageryLayerConfig,
  BasemapConfig,
  SpriteSource,
  UIConfig,
  ViewConfig,
  MapConfig,
  BrandingConfig,
  SourceAuth,
  GlobalSearchConfig,
  InfoConfig,
  SourceGroup,
} from '@ogc-maps/storybook-components';
import { ImageUploadField } from '../components/ImageUploadField';
import { MapPreview } from '../components/MapPreview';
import { JsonConfigEditor } from '../components/JsonConfigEditor';
import { useQueryablesByLayer } from '../hooks/useQueryablesByLayer';
import { prettifyZodIssue } from '../utils/prettifyZodPath';
import { lintMapConfig, type WizardLintIssue } from '../utils/lintMapConfig';
import { TIPG_LOCAL_SOURCE_ID } from '../utils/detectLocalOgcApi';

const DEFAULT_GLOBAL_SEARCH: GlobalSearchConfig = {
  enabled: true,
  layers: [],
  maxResultsPerLayer: 10,
  debounceMs: 250,
  minQueryLength: 2,
  position: 'top-left',
  width: 'md',
};

const DEFAULT_INFO: InfoConfig = {
  enabled: false,
  markdown: '',
  position: 'top-right',
};

const INFO_POSITION_OPTIONS = INFO_POSITIONS.map((pos) => ({
  value: pos,
  label: pos.replace('-', ' ').replace(/^./, (c) => c.toUpperCase()),
}));

interface SavedSourceSummary { id: string; source_id: string; url: string; label: string | null; tile_matrix_set_id: string; source_type?: string; auth?: SourceAuth | null; metadata?: { thumbnail?: string; tileJson?: { tiles: string[]; name?: string; minzoom?: number; maxzoom?: number }; wmtsLayer?: string; wmtsStyle?: string; wmtsFormat?: string; wmtsTileMatrixSet?: string; wmtsTileSize?: number } | null }

type WizardStep = 'metadata' | 'info' | 'layers' | 'search-display' | 'imagery' | 'basemaps' | 'ui' | 'view' | 'review';

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'metadata', label: 'Metadata' },
  { key: 'info', label: 'Info' },
  { key: 'basemaps', label: 'Basemaps' },
  { key: 'imagery', label: 'Imagery' },
  { key: 'layers', label: 'Layers' },
  { key: 'search-display', label: 'Search & Display' },
  { key: 'ui', label: 'UI' },
  { key: 'view', label: 'View' },
  { key: 'review', label: 'Review' },
];

const DEFAULT_UI_CONFIG: UIConfig = {
  showLayerPanel: false,
  showLegend: false,
  showBasemapSwitcher: false,
  showSearchPanel: false,
  showCoordinateDisplay: false,
  showFeatureDetail: false,
  showFeatureTooltip: false,
  showExportButton: false,
  showExportPdf: false,
  showLegendOpacity: false,
  showMeasureTool: false,
  showSelectionTool: false,
  showImageryPanel: false,
  showCompass: false,
  showGlobalSearch: false,
  showScaleBar: false,
  coordinateFormat: 'decimal-degrees',
  controlLayout: 'individual',
  sideMenuToggleCorner: 'top-right',
};

/** Derive which UI controls should be enabled based on current config state. */
/**
 * True when a feature source is the local OGC API (the one that serves uploaded
 * "My Data"). Identified by same-origin `/ogc` URL rather than a fixed source id,
 * so it works regardless of how the source was named (`tipg-local`,
 * `tipg-localhost`, etc.). The canonical id is kept as a fallback.
 */
function isLocalOgcSource(source: { id: string; url: string }): boolean {
  if (source.id === TIPG_LOCAL_SOURCE_ID) return true;
  try {
    const u = new URL(source.url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.replace(/\/+$/, '').endsWith('/ogc');
  } catch {
    return false;
  }
}

function computeSuggestedUI(
  layers: LayerConfig[],
  basemaps: BasemapConfig[],
  imageryLayers: ImageryLayerConfig[],
): Partial<UIConfig> {
  const suggested: Partial<UIConfig> = {};

  if (layers.length > 0) {
    suggested.showLayerPanel = true;
    suggested.showCoordinateDisplay = true;
    suggested.showExportButton = true;
    suggested.showFeatureDetail = true;
    suggested.showFeatureTooltip = true;
  }

  if (basemaps.length > 1) {
    suggested.showBasemapSwitcher = true;
  }

  if (layers.some(l => l.legend)) {
    suggested.showLegend = true;
    suggested.showLegendOpacity = true;
  }

  if (layers.some(l => l.search)) {
    suggested.showSearchPanel = true;
  }

  if (layers.some(l => l.cql2Filter)) {
    suggested.showSelectionTool = true;
  }

  if (imageryLayers.length > 0) {
    suggested.showImageryPanel = true;
  }

  return suggested;
}

const DEFAULT_VIEW: ViewConfig = {
  latitude: 0,
  longitude: 0,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

const PRESET_SPRITES: (SpriteSource & { displayLabel: string })[] = [
  { id: 'maplibre-osm-bright', url: 'https://demotiles.maplibre.org/styles/osm-bright-gl-style/sprite', displayLabel: 'MapLibre OSM Bright' },
];

export function ConfigWizardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WizardStep>('metadata');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(true);
  const [previewLayout, setPreviewLayout] = useState<'horizontal' | 'vertical'>('vertical');

  // Branding state (single object, matches uiConfig pattern)
  const [branding, setBranding] = useState<BrandingConfig>({});
  const updateBranding = (patch: Partial<BrandingConfig>) => setBranding(prev => ({ ...prev, ...patch }));

  // Config state
  const [sources, setSources] = useState<MapSource[]>([]);
  const [layers, setLayers] = useState<LayerConfig[]>([]);
  // In-progress new-layer draft, lifted out of LayerList so the MapPreview can render it live before "Save Layer" is clicked.
  const [layerDraft, setLayerDraft] = useState<LayerConfig | null>(null);
  const [basemaps, setBasemaps] = useState<BasemapConfig[]>([]);
  const [sprites, setSprites] = useState<SpriteSource[]>([]);
  const [availableIcons, setAvailableIcons] = useState<string[]>([]);
  const [imageryLayers, setImageryLayers] = useState<ImageryLayerConfig[]>([]);
  const [uiOverrides, setUiOverrides] = useState<Partial<UIConfig>>({});
  const [globalSearch, setGlobalSearch] = useState<GlobalSearchConfig | undefined>(undefined);
  const [info, setInfo] = useState<InfoConfig | undefined>(undefined);
  const [initialView, setInitialView] = useState<ViewConfig>(DEFAULT_VIEW);

  // Layers as displayed in the right-hand MapPreview: real layers + an optional draft entry.
  // Synthesizes a stable preview-only id so MapLibre doesn't collide with empty/duplicate ids,
  // and so that draft-induced edits coming back through onLayersChange can be filtered out.
  const PREVIEW_DRAFT_ID = '__draft_layer_preview__';
  // Multi-geometry default style applied to drafts that don't yet have a style configured.
  // MapLibre silently no-ops style types that don't match the source-layer geometry, so attaching
  // all three lets the draft show up regardless of whether the collection is polygon, line, or point.
  const DRAFT_DEFAULT_STYLES: NonNullable<LayerConfig['styles']> = [
    { type: 'fill', paint: { 'fill-color': '#6366f1', 'fill-opacity': 0.35 } },
    { type: 'line', paint: { 'line-color': '#6366f1', 'line-width': 1.5, 'line-opacity': 1 } },
    { type: 'circle', paint: { 'circle-color': '#6366f1', 'circle-radius': 5, 'circle-opacity': 1, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } },
  ];
  const previewLayers = useMemo<LayerConfig[]>(() => {
    if (!layerDraft || !layerDraft.sourceId || !layerDraft.collection) return layers;
    const styles = layerDraft.styles?.length ? layerDraft.styles : DRAFT_DEFAULT_STYLES;
    return [...layers, { ...layerDraft, id: PREVIEW_DRAFT_ID, styles }];
  }, [layers, layerDraft]);

  // Derive effective UI config: all-false defaults → auto-suggestions → user overrides.
  // Suggestions are computed against `previewLayers` (committed + in-progress draft) so that
  // enabling a feature on a draft layer immediately lights up the corresponding panel in the live preview.
  const suggestedUI = useMemo(
    () => computeSuggestedUI(previewLayers, basemaps, imageryLayers),
    [previewLayers, basemaps, imageryLayers],
  );

  const { effectiveUIConfig, autoEnabledKeys } = useMemo(() => {
    const effective = { ...DEFAULT_UI_CONFIG } as Record<string, unknown>;
    const auto = new Set<keyof UIConfig>();
    for (const key of Object.keys(suggestedUI) as (keyof UIConfig)[]) {
      if (key === 'controlOrder') continue;
      if (suggestedUI[key]) {
        effective[key] = true;
        if (!(key in uiOverrides)) auto.add(key);
      }
    }
    for (const key of Object.keys(uiOverrides) as (keyof UIConfig)[]) {
      const override = uiOverrides[key];
      if (override !== undefined) {
        effective[key] = override;
      }
    }
    return { effectiveUIConfig: effective as UIConfig, autoEnabledKeys: auto };
  }, [suggestedUI, uiOverrides]);

  const handleUIChange = (newConfig: UIConfig) => {
    setUiOverrides(prev => {
      const updated = { ...prev } as Record<string, unknown>;
      const effective = effectiveUIConfig as Record<string, unknown>;
      for (const key of Object.keys(newConfig) as (keyof UIConfig)[]) {
        const next = (newConfig as Record<string, unknown>)[key];
        if (next !== effective[key]) {
          updated[key] = next;
        }
      }
      return updated as Partial<UIConfig>;
    });
  };

  // Resolve available icon names from basemap + custom sprites
  useEffect(() => {
    let stale = false;
    const basemapUrl = basemaps[0]?.url;
    resolveAvailableIcons(basemapUrl, sprites)
      .then(icons => { if (!stale) setAvailableIcons(icons); })
      .catch(() => {});
    return () => { stale = true; };
  }, [basemaps, sprites]);

  // Saved sources from the sources catalog
  const [savedSources, setSavedSources] = useState<SavedSourceSummary[]>([]);

  useEffect(() => {
    fetch('/api/sources')
      .then(res => res.json())
      .then(data => setSavedSources(data as SavedSourceSummary[]))
      .catch(() => {});
  }, []);

  // Imagery CollectionBrowser source selector state
  const [imageryBrowseSourceId, setImageryBrowseSourceId] = useState('');

  const isEditing = !!id;
  const currentStepIndex = STEPS.findIndex(s => s.key === currentStep);

  // Queryables for global search config editor (eager fetch per layer)
  const { queryablesByLayer, queryablesLoading } = useQueryablesByLayer(layers, sources);

  // Derived config object for save + preview
  const hasBranding = Object.keys(branding).length > 0;

  const assembledConfig: MapConfig = { sources, layers, ...(imageryLayers.length > 0 ? { imageryLayers } : {}), basemaps, sprites: sprites.length > 0 ? sprites : undefined, ui: effectiveUIConfig, initialView, ...(hasBranding && { branding }), ...(globalSearch ? { globalSearch } : {}), ...(info ? { info } : {}) };

  const handlePreviewLayersChange = useCallback((next: LayerConfig[]) => {
    setLayers(next.filter(l => l.id !== PREVIEW_DRAFT_ID));
  }, []);

  // Drop a half-edited draft when navigating away from the layers step, so returning later
  // doesn't show a stale Add-Layer form.
  useEffect(() => {
    if (currentStep !== 'layers' && layerDraft !== null) setLayerDraft(null);
  }, [currentStep, layerDraft]);

  // Pre-save lint pass — catches issues that pass schema validation (or
  // aren't expressible in Zod) but should still block save with a clear,
  // row-specific message + remediation.
  const lintIssues: WizardLintIssue[] = useMemo(
    () =>
      lintMapConfig({
        layers,
        imageryLayers,
        globalSearch,
        queryablesByLayer,
        queryablesLoading,
      }),
    [layers, imageryLayers, globalSearch, queryablesByLayer, queryablesLoading],
  );

  const lintErrorCount = lintIssues.filter((i) => i.severity === 'error').length;
  const hasIncompleteImagery = imageryLayers.some(isImageryLayerIncomplete);

  const isConfigValid = useMemo(() => {
    if (!name) return false;
    if (lintErrorCount > 0) return false;
    return safeValidateMapConfig(assembledConfig).success;
  }, [name, assembledConfig, lintErrorCount]);

  // Clear "Saved" indicator when config changes
  useEffect(() => { setJustSaved(false); }, [assembledConfig, name, description]);


  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/configs/${id}`)
      .then(res => res.json())
      .then((data: { name?: string; description?: string; config?: MapConfig }) => {
        setName(data.name ?? '');
        setDescription(data.description ?? '');
        if (data.config) {
          setSources(data.config.sources ?? []);
          setLayers(data.config.layers ?? []);
          setImageryLayers(data.config.imageryLayers ?? []);
          setBasemaps(data.config.basemaps ?? []);
          setSprites(data.config.sprites ?? []);
          setUiOverrides(data.config.ui ?? DEFAULT_UI_CONFIG);
          setGlobalSearch(data.config.globalSearch);
          setInfo(data.config.info);
          setInitialView(data.config.initialView ?? DEFAULT_VIEW);
          if (data.config.branding) {
            setBranding(data.config.branding);
          }
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  /** Replace all wizard state from a validated MapConfig (used by the JSON editor). */
  const handleReplaceConfig = (next: MapConfig) => {
    setSources(next.sources ?? []);
    setLayers(next.layers ?? []);
    setImageryLayers(next.imageryLayers ?? []);
    setBasemaps(next.basemaps ?? []);
    setSprites(next.sprites ?? []);
    setUiOverrides(next.ui ?? {});
    setGlobalSearch(next.globalSearch);
    setInfo(next.info);
    setInitialView(next.initialView ?? DEFAULT_VIEW);
    setBranding(next.branding ?? {});
    setValidationErrors([]);
  };

  const handleSave = async () => {
    setSaving(true);
    setJustSaved(false);
    setError(null);
    setValidationErrors([]);

    if (lintErrorCount > 0) {
      setValidationErrors(
        lintIssues
          .filter((i) => i.severity === 'error')
          .map((i) => `${i.path}: ${i.message}`),
      );
      setSaving(false);
      return;
    }

    const validation = safeValidateMapConfig(assembledConfig);
    if (!validation.success) {
      setValidationErrors(validation.error.issues.map((issue) => prettifyZodIssue(issue)));
      setSaving(false);
      return;
    }

    try {
      const body = { name, description, config: assembledConfig };
      const url = isEditing ? `/api/configs/${id}` : '/api/configs';
      const method = isEditing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());

      if (currentStep === 'review') {
        navigate('/configs');
      } else {
        if (!isEditing) {
          const created = await res.json();
          navigate(`/configs/${created.id}/edit`, { replace: true });
        }
        setJustSaved(true);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  // Apply a lint-issue remediation (one-click "remove offending row" buttons).
  const applyLintRemediation = useCallback(
    (remediation: WizardLintIssue['remediation']) => {
      if (!remediation) return;
      switch (remediation.kind) {
        case 'remove-imagery-row':
          setImageryLayers((prev) => prev.filter((_, i) => i !== remediation.index));
          break;
        case 'remove-search-field':
          setLayers((prev) =>
            prev.map((l) => {
              if (l.id !== remediation.layerId) return l;
              const fields = l.search?.fields ?? [];
              const nextFields = fields.filter((_, i) => i !== remediation.index);
              if (nextFields.length === 0) {
                const { search: _omit, ...rest } = l;
                return rest as LayerConfig;
              }
              return { ...l, search: { ...l.search!, fields: nextFields } };
            }),
          );
          break;
        case 'remove-global-search-property':
          setGlobalSearch((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              layers: prev.layers.map((entry) =>
                entry.layerId === remediation.layerId
                  ? { ...entry, properties: entry.properties.filter((_, i) => i !== remediation.index) }
                  : entry,
              ),
            };
          });
          break;
      }
    },
    [],
  );

  // Imagery collection select/deselect
  const handleImageryCollectionSelect = (collectionId: string, collectionTitle?: string) => {
    if (!imageryBrowseSourceId) return;
    const layerId = `${imageryBrowseSourceId}-${collectionId}`;
    const newLayer: ImageryLayerConfig = {
      id: layerId,
      sourceId: imageryBrowseSourceId,
      collection: collectionId,
      label: collectionTitle ?? collectionId,
      visible: false,
      opacity: 1,
      exclusive: false,
      tileSize: 256,
    };
    setImageryLayers(prev => [...prev, newLayer]);
  };

  const handleImageryCollectionDeselect = (collectionId: string) => {
    setImageryLayers(prev =>
      prev.filter(l => !(l.sourceId === imageryBrowseSourceId && l.collection === collectionId)),
    );
  };

  const handleAddCustomImageryLayer = () => {
    const newLayer: ImageryLayerConfig = {
      id: '',
      sourceId: '',
      collection: '',
      label: 'Custom Imagery Layer',
      visible: false,
      opacity: 1,
      exclusive: false,
      tileSize: 256,
      tileUrlTemplate: '',
    };
    setImageryLayers(prev => [...prev, newLayer]);
  };

  const imageryBrowseSource = sources.find(s => s.id === imageryBrowseSourceId);
  const imageryBrowseSourceType =
    imageryBrowseSource && isOgcApiSource(imageryBrowseSource)
      ? detectTileSourceType(imageryBrowseSource.url)
      : null;
  const imagerySelectedCollectionIds = imageryLayers
    .filter(l => l.sourceId === imageryBrowseSourceId)
    .map(l => l.collection);

  // Derive filtered saved sources by type
  const savedFeatureSources = savedSources.filter(s => (s.source_type ?? 'features') === 'features');
  const savedImagerySources = savedSources.filter(s => s.source_type === 'imagery' || s.source_type === 'wmts');
  const savedBasemapSources = savedSources.filter(s => s.source_type === 'basemap');
  const imageryOgcSources = sources.filter(
    (s): s is OgcApiSource =>
      isOgcApiSource(s) && s.type === 'imagery' && detectTileSourceType(s.url) === 'ogc-api',
  );

  // All feature sources available for the layer dropdown: config-embedded + saved catalog (deduped)
  const allFeatureSourcesForDropdown = useMemo<OgcApiSource[]>(() => {
    const catalogSources: OgcApiSource[] = savedFeatureSources.map(saved => ({
      id: saved.source_id,
      url: saved.url,
      label: saved.label ?? undefined,
      tileMatrixSetId: saved.tile_matrix_set_id,
      type: 'features' as const,
      auth: saved.auth ?? undefined,
    }));
    const existingIds = new Set(sources.map(s => s.id));
    return [
      ...sources.filter(
        (s): s is OgcApiSource => isOgcApiSource(s) && (s.type ?? 'features') === 'features',
      ),
      ...catalogSources.filter(cs => !existingIds.has(cs.id)),
    ];
  }, [sources, savedFeatureSources]);

  // Group the layer-editor source picker into "My Data" (the local OGC API that
  // serves uploaded datasets) vs "External Sources" (everything else). The local
  // source is identified by URL (same-origin `/ogc`) rather than a fixed id, so
  // it works whatever the source was named (e.g. `tipg-local`, `tipg-localhost`).
  const featureSourceGroups = useMemo<SourceGroup[]>(() => {
    const myDataIds = allFeatureSourcesForDropdown.filter(isLocalOgcSource).map(s => s.id);
    const myDataSet = new Set(myDataIds);
    const externalIds = allFeatureSourcesForDropdown.filter(s => !myDataSet.has(s.id)).map(s => s.id);
    const groups: SourceGroup[] = [];
    if (myDataIds.length) groups.push({ id: 'my-data', label: 'My Data', sourceIds: myDataIds });
    if (externalIds.length) groups.push({ id: 'external', label: 'External Sources', sourceIds: externalIds });
    return groups;
  }, [allFeatureSourcesForDropdown]);

  // Wrapper around setLayers that keeps sources[] in sync:
  // auto-adds newly referenced feature sources from the catalog.
  // Does NOT auto-prune — pruning caused sources already embedded in the config
  // (and not present in the /api/sources catalog) to be silently dropped when a
  // layer's sourceId was edited, breaking MapConfig validation (sources: min(1)).
  const handleLayersChange = useCallback((nextLayers: LayerConfig[]) => {
    setLayers(nextLayers);
    setSources(prev => {
      const referencedIds = new Set(nextLayers.map(l => l.sourceId).filter(Boolean));
      const currentIds = new Set(prev.map(s => s.id));
      const toAdd: OgcApiSource[] = [];
      for (const sid of referencedIds) {
        if (currentIds.has(sid)) continue;
        const saved = savedFeatureSources.find(s => s.source_id === sid);
        if (saved) {
          toAdd.push({
            id: saved.source_id,
            url: saved.url,
            label: saved.label ?? undefined,
            tileMatrixSetId: saved.tile_matrix_set_id,
            type: 'features' as const,
            auth: saved.auth ?? undefined,
          });
        }
      }
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }, [savedFeatureSources]);

  // Keep `sources` in sync with the in-progress draft layer too, so the MapPreview
  // can resolve a sourceUrl for it before the user clicks "Save Layer".
  // Mirrors handleLayersChange's auto-add path (no auto-prune, same reason).
  useEffect(() => {
    const sid = layerDraft?.sourceId;
    if (!sid) return;
    setSources(prev => {
      if (prev.some(s => s.id === sid)) return prev;
      const saved = savedFeatureSources.find(s => s.source_id === sid);
      if (!saved) return prev;
      return [...prev, {
        id: saved.source_id,
        url: saved.url,
        label: saved.label ?? undefined,
        tileMatrixSetId: saved.tile_matrix_set_id,
        type: 'features' as const,
        auth: saved.auth ?? undefined,
      }];
    });
  }, [layerDraft?.sourceId, savedFeatureSources]);

  const isBasemapSelected = (saved: SavedSourceSummary) =>
    basemaps.some(b => b.url === saved.url);

  const toggleBasemapSource = (saved: SavedSourceSummary) => {
    setBasemaps(prev =>
      prev.some(b => b.url === saved.url)
        ? prev.filter(b => b.url !== saved.url)
        : [...prev, {
            id: saved.source_id,
            label: saved.label ?? saved.source_id,
            url: saved.url,
            thumbnail: saved.metadata?.thumbnail,
          }],
    );
  };

  const isSpriteSelected = (preset: { id: string; url: string }) =>
    sprites.some(s => s.url === preset.url);

  const toggleSpritePreset = (preset: { id: string; url: string }) => {
    setSprites(prev =>
      prev.some(s => s.url === preset.url)
        ? prev.filter(s => s.url !== preset.url)
        : [...prev, { id: preset.id, url: preset.url }],
    );
  };

  if (loading) {
    return (
      <div className="mapui:flex mapui:items-center mapui:justify-center mapui:p-16 mapui:text-slate-500">
        <span className="mapui:inline-block mapui:h-6 mapui:w-6 mapui:animate-spin mapui:rounded-full mapui:border-2 mapui:border-slate-300 mapui:border-t-blue-600 mapui:mr-3" />
        Loading map…
      </div>
    );
  }

  return (
    <div className={`mapui:flex ${previewLayout === 'vertical' ? 'mapui:flex-row' : 'mapui:flex-col'} mapui:h-[calc(100vh-4rem)]`}>
      {/* Left: wizard form (scrollable) */}
      <div className="mapui:flex-1 mapui:min-w-0 mapui:overflow-y-auto mapui:p-8">
        <div className="mapui:max-w-3xl mapui:mx-auto">
      <h1 className="mapui:text-2xl mapui:font-bold mapui:text-slate-900 mapui:mb-6">
        {isEditing ? 'Edit Map' : 'Create Map'}
      </h1>

      {/* Step progress */}
      <div className="mapui:flex mapui:gap-1 mapui:mb-8 mapui:overflow-x-auto mapui:pb-3">
        {STEPS.map((step, i) => (
          <button
            key={step.key}
            onClick={() => setCurrentStep(step.key)}
            className={`mapui:flex-1 mapui:py-2 mapui:px-3 mapui:text-sm mapui:rounded mapui:font-medium mapui:whitespace-nowrap ${
              step.key === currentStep
                ? 'mapui:bg-blue-600 mapui:text-white'
                : i < currentStepIndex
                ? 'mapui:bg-blue-100 mapui:text-blue-700'
                : 'mapui:bg-slate-100 mapui:text-slate-500'
            }`}
          >
            {i + 1}. {step.label}
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="mapui:bg-white mapui:rounded-lg mapui:shadow mapui:p-6 mapui:mb-6">
        {currentStep === 'metadata' && (
          <div className="mapui:space-y-4">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800">Map Metadata</h2>
            <div>
              <label className="mapui:block mapui:text-sm mapui:font-medium mapui:text-slate-700 mapui:mb-1">
                Name <span className="mapui:text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-'))}
                onBlur={() => setName(name.replace(/^-|-$/g, '').toLowerCase())}
                placeholder="my-map-config"
                className="mapui:w-full mapui:border mapui:border-slate-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:font-mono mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
              />
              <p className="mapui:text-xs mapui:text-slate-400 mapui:mt-1">
                Lowercase letters, numbers, and hyphens (e.g. &quot;my-map-config&quot;)
              </p>
            </div>
            <div>
              <label className="mapui:block mapui:text-sm mapui:font-medium mapui:text-slate-700 mapui:mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe what this map is for..."
                rows={3}
                className="mapui:w-full mapui:border mapui:border-slate-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
              />
            </div>

            <CollapsibleSection title="Branding" badge="optional">
              <div className="mapui:flex mapui:flex-col mapui:gap-4">
                <FormField label="Header Title" description="Title shown in the map header bar">
                  <input
                    type="text"
                    value={branding.headerTitle ?? ''}
                    onChange={e => updateBranding({ headerTitle: e.target.value || undefined })}
                    placeholder="My Map"
                    className="mapui:w-full mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
                  />
                </FormField>

                <FormField label="Header Background Color">
                  <ColorPicker value={branding.headerColor ?? DEFAULT_HEADER_COLOR} onChange={color => updateBranding({ headerColor: color })} />
                </FormField>

                <FormField label="Browser Tab Title" description="Title shown in the browser tab">
                  <input
                    type="text"
                    value={branding.browserTitle ?? ''}
                    onChange={e => updateBranding({ browserTitle: e.target.value || undefined })}
                    placeholder="My Map"
                    className="mapui:w-full mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
                  />
                </FormField>

                <FormField label="Favicon" description="Icon shown in the browser tab (PNG, ICO, or SVG, max 100KB)">
                  <ImageUploadField
                    value={branding.faviconDataUrl ?? null}
                    onChange={dataUrl => updateBranding({ faviconDataUrl: dataUrl ?? undefined })}
                    accept="image/png,image/x-icon,image/svg+xml"
                    maxSizeKb={100}
                    previewHeight={32}
                  />
                </FormField>

                <FormField label="Logo" description="Logo image displayed in the header (PNG, JPEG, or SVG, max 200KB)">
                  <ImageUploadField
                    value={branding.logoDataUrl ?? null}
                    onChange={dataUrl => updateBranding({ logoDataUrl: dataUrl ?? undefined })}
                    accept="image/png,image/jpeg,image/svg+xml"
                    maxSizeKb={200}
                    previewHeight={40}
                  />
                </FormField>

                <FormField label="Logo Height (px)" description="Height of the logo. Logos taller than the header will extend below it.">
                  <input
                    type="number"
                    min={16}
                    max={200}
                    value={branding.logoHeight ?? 32}
                    onChange={e => updateBranding({ logoHeight: Number(e.target.value) })}
                    className="mapui:w-24 mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
                  />
                </FormField>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {currentStep === 'info' && (
          <div className="mapui:space-y-4">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800">Info Control</h2>
            <p className="mapui:text-sm mapui:text-slate-500">
              Add an informational modal accessible from a floating button on the map. Useful for map credits,
              data sources, usage notes, or a welcome message.
            </p>

            {(() => {
              const current = info ?? DEFAULT_INFO;
              const enabled = current.enabled;
              return (
                <>
                  <FormField label="Enable">
                    <label className="mapui:inline-flex mapui:items-center mapui:gap-2 mapui:text-sm mapui:text-slate-700">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={e => setInfo({ ...current, enabled: e.target.checked })}
                      />
                      Show info control on the map
                    </label>
                  </FormField>

                  <FormField label="Modal title" description="Defaults to 'About this map' if blank">
                    <input
                      type="text"
                      value={current.title ?? ''}
                      onChange={e => {
                        const title = e.target.value;
                        setInfo({ ...current, title: title === '' ? undefined : title, enabled: title !== '' ? true : current.enabled });
                      }}
                      placeholder="About this map"
                      className="mapui:w-full mapui:border mapui:border-slate-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
                    />
                  </FormField>

                  <FormField label="Position">
                    <select
                      value={current.position}
                      onChange={e => setInfo({ ...current, position: e.target.value as InfoConfig['position'] })}
                      className="mapui:w-full mapui:border mapui:border-slate-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
                    >
                      {INFO_POSITION_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField label="Markdown content">
                    <textarea
                      value={current.markdown}
                      onChange={e => setInfo({ ...current, markdown: e.target.value, enabled: e.target.value !== '' ? true : current.enabled })}
                      placeholder={'# About this map\n\nDescribe your map, data sources, or usage notes here.'}
                      rows={16}
                      className="mapui:w-full mapui:border mapui:border-slate-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:font-mono mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
                    />
                    <p className="mapui:text-xs mapui:text-slate-500 mapui:mt-1">
                      Markdown supports headings, lists, links, tables, and code blocks. Links open in a new tab.
                    </p>
                  </FormField>
                </>
              );
            })()}
          </div>
        )}

        {currentStep === 'layers' && (
          <div className="mapui:space-y-6">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800">Layers</h2>

            {/* Layer list — add layers one at a time, configure style + legend */}
            <LayerList
              layers={layers}
              onChange={handleLayersChange}
              availableSources={allFeatureSourcesForDropdown}
              availableSourceGroups={featureSourceGroups}
              availableIcons={availableIcons}
              sections={['style', 'legend']}
              draftLayer={layerDraft}
              onDraftChange={setLayerDraft}
            />
          </div>
        )}

        {currentStep === 'search-display' && (
          <div className="mapui:space-y-4">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800">Search & Display</h2>
            <p className="mapui:text-sm mapui:text-slate-500 mapui:m-0">
              Configure search fields, property display, and filters for each layer.
            </p>
            {layers.length === 0 ? (
              <div className="mapui:rounded mapui:bg-blue-50 mapui:border mapui:border-blue-200 mapui:p-4 mapui:text-sm mapui:text-blue-800">
                No layers configured yet. Go back to the <strong>Layers</strong> step to add layers.
              </div>
            ) : (
              <LayerList
                layers={layers}
                onChange={handleLayersChange}
                availableSources={allFeatureSourcesForDropdown}
                sections={['search', 'propertyDisplay', 'cql2Filter']}
                showBasicFields={false}
                readOnly
              />
            )}
          </div>
        )}

        {currentStep === 'imagery' && (
          <div className="mapui:space-y-6">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800">Imagery Layers</h2>

            {/* Saved imagery sources picker */}
            {savedImagerySources.length > 0 && (
              <div>
                <h3 className="mapui:text-sm mapui:font-semibold mapui:text-slate-700 mapui:mb-3">Saved Imagery Sources</h3>
                <div className="mapui:flex mapui:flex-wrap mapui:gap-2">
                  {savedImagerySources.map(saved => {
                    const alreadyAdded = sources.some(s => s.id === saved.source_id);
                    return (
                      <button
                        key={saved.id}
                        type="button"
                        onClick={() => {
                          if (alreadyAdded) {
                            setSources(prev => prev.filter(s => s.id !== saved.source_id));
                            setImageryLayers(prev => prev.filter(l => l.sourceId !== saved.source_id));
                            return;
                          }
                          // WMTS sources carry their layer/style/matrixset in the
                          // saved row's metadata — reconstruct the WmtsSource and
                          // auto-add an imagery layer that just points at it (no
                          // collection, no template; buildSourceUrlMap derives the URL).
                          if (saved.source_type === 'wmts') {
                            const wmtsSource: WmtsSource = savedSourceToWmts(saved);
                            setSources(prev => [...prev, wmtsSource]);
                            const label = saved.label ?? saved.source_id;
                            setImageryLayers(prev => [...prev, {
                              id: slugify(label) || saved.source_id,
                              sourceId: saved.source_id,
                              collection: '',
                              label,
                              visible: false,
                              opacity: 1,
                              exclusive: false,
                              tileSize: 256,
                            }]);
                            return;
                          }

                          const newSource: OgcApiSource = {
                            id: saved.source_id,
                            url: saved.url,
                            label: saved.label ?? undefined,
                            tileMatrixSetId: saved.tile_matrix_set_id,
                            type: 'imagery' as const,
                            auth: saved.auth ?? undefined,
                          };
                          setSources(prev => [...prev, newSource]);

                          // Auto-add imagery layer for TileJSON/XYZ sources
                          const urlType = detectTileSourceType(saved.url);
                          if (urlType === 'style') return; // style URLs handled by Basemaps tab
                          const tj = urlType === 'tilejson' ? saved.metadata?.tileJson : null;
                          const tileUrl = urlType === 'xyz' ? saved.url : tj?.tiles?.[0];
                          if (tileUrl) {
                            const label = (tj?.name ?? saved.label ?? saved.source_id);
                            setImageryLayers(prev => [...prev, {
                              id: slugify(label) || saved.source_id,
                              sourceId: saved.source_id,
                              collection: '',
                              label,
                              visible: false,
                              opacity: 1,
                              exclusive: false,
                              tileSize: 256,
                              tileUrlTemplate: tileUrl,
                              ...(tj?.minzoom != null ? { minZoom: tj.minzoom } : {}),
                              ...(tj?.maxzoom != null ? { maxZoom: tj.maxzoom } : {}),
                            }]);
                          }
                        }}
                        className={`mapui:inline-flex mapui:items-center mapui:gap-1.5 mapui:rounded-full mapui:border mapui:px-3 mapui:py-1.5 mapui:text-sm mapui:transition-colors mapui:cursor-pointer ${
                          alreadyAdded
                            ? 'mapui:border-purple-500 mapui:bg-purple-50 mapui:text-purple-700 mapui:hover:border-purple-300 mapui:hover:bg-purple-100'
                            : 'mapui:border-slate-300 mapui:bg-white mapui:text-slate-600 mapui:hover:border-purple-400 mapui:hover:bg-purple-50'
                        }`}
                      >
                        {alreadyAdded && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {saved.label ?? saved.source_id}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mapui:space-y-6">
                  {/* Section A: Browse & select collections (only for OGC API imagery sources) */}
                  {imageryOgcSources.length > 0 && (
                    <CollapsibleSection
                      title="Browse Collections"
                      defaultOpen={true}
                      badge={imagerySelectedCollectionIds.length}
                    >
                      <p className="mapui:text-xs mapui:text-slate-500 mapui:mb-3">
                        Select an OGC API source and check the collections you want to add as imagery layers.
                      </p>
                      <div className="mapui:mb-3">
                        <label className="mapui:block mapui:text-xs mapui:font-medium mapui:text-slate-600 mapui:mb-1">
                          Source
                        </label>
                        <select
                          value={imageryBrowseSourceId}
                          onChange={e => setImageryBrowseSourceId(e.target.value)}
                          className="mapui:w-full mapui:border mapui:border-slate-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
                        >
                          <option value="">Select a source...</option>
                          {imageryOgcSources.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.label ?? s.id}
                            </option>
                          ))}
                        </select>
                      </div>
                      {imageryBrowseSource && isOgcApiSource(imageryBrowseSource) && imageryBrowseSourceType === 'ogc-api' && (
                        <CollectionBrowser
                          sourceUrl={imageryBrowseSource.url}
                          sourceAuth={imageryBrowseSource.auth}
                          selectedCollectionIds={imagerySelectedCollectionIds}
                          onSelect={(collectionId) => handleImageryCollectionSelect(collectionId)}
                          onDeselect={handleImageryCollectionDeselect}
                        />
                      )}
                    </CollapsibleSection>
                  )}

                  {/* Custom layer button */}
                  <button
                    type="button"
                    onClick={handleAddCustomImageryLayer}
                    className="mapui:text-sm mapui:text-blue-600 hover:mapui:text-blue-800 mapui:underline"
                  >
                    + Add custom imagery layer (non-OGC tile URL)
                  </button>

                  {/* Section B: Configure selected layers */}
                  {imageryLayers.length > 0 && (
                    <div>
                      <h3 className="mapui:text-sm mapui:font-semibold mapui:text-slate-700 mapui:mb-3">
                        Configure Imagery Layers
                        <span className="mapui:ml-2 mapui:text-xs mapui:font-normal mapui:text-slate-400">
                          {imageryLayers.length} layer{imageryLayers.length !== 1 ? 's' : ''}
                        </span>
                      </h3>
                      <ImageryList
                        imageryLayers={imageryLayers}
                        onChange={setImageryLayers}
                        availableSources={sources.filter(isImagerySource)}
                      />
                    </div>
                  )}
                </div>
          </div>
        )}

        {currentStep === 'basemaps' && (
          <div className="mapui:space-y-6">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800">Basemaps</h2>

            {/* Saved Basemap Sources */}
            {savedBasemapSources.length > 0 ? (
              <div>
                <h3 className="mapui:text-sm mapui:font-semibold mapui:text-slate-700 mapui:mb-3">Available Basemaps</h3>
                <div className="mapui:grid mapui:grid-cols-3 mapui:gap-3">
                  {savedBasemapSources.map(saved => {
                    const selected = isBasemapSelected(saved);
                    return (
                      <button
                        key={saved.id}
                        type="button"
                        onClick={() => toggleBasemapSource(saved)}
                        className={`mapui:relative mapui:flex mapui:flex-col mapui:items-center mapui:gap-2 mapui:rounded-lg mapui:border-2 mapui:p-4 mapui:text-sm mapui:transition-colors ${
                          selected
                            ? 'mapui:border-blue-500 mapui:bg-blue-50'
                            : 'mapui:border-slate-200 mapui:bg-white mapui:hover:border-slate-300'
                        }`}
                      >
                        {selected && (
                          <span className="mapui:absolute mapui:top-2 mapui:right-2 mapui:text-blue-600">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                        {saved.metadata?.thumbnail ? (
                          <img src={saved.metadata.thumbnail} alt="" className="mapui:w-10 mapui:h-10 mapui:rounded-full mapui:object-cover" />
                        ) : (
                          <span className="mapui:w-10 mapui:h-10 mapui:rounded-full mapui:bg-slate-300" />
                        )}
                        <span className="mapui:font-medium mapui:text-slate-700">{saved.label ?? saved.source_id}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mapui:rounded mapui:bg-yellow-50 mapui:border mapui:border-yellow-200 mapui:p-4 mapui:text-sm mapui:text-yellow-800">
                No basemap sources saved yet. Add basemaps in the <strong>Sources</strong> page, or add custom basemaps below.
              </div>
            )}

            {/* Custom Basemaps */}
            <div>
              <BasemapList basemaps={basemaps} onChange={setBasemaps} />
            </div>

            {/* Preset Sprite Sheets */}
            <div>
              <h3 className="mapui:text-sm mapui:font-semibold mapui:text-slate-700 mapui:mb-3">Preset Sprite Sheets</h3>
              <div className="mapui:flex mapui:flex-wrap mapui:gap-2">
                {PRESET_SPRITES.map(preset => {
                  const selected = isSpriteSelected(preset);
                  return (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => toggleSpritePreset(preset)}
                      className={`mapui:inline-flex mapui:items-center mapui:gap-1.5 mapui:rounded-full mapui:border mapui:px-3 mapui:py-1.5 mapui:text-sm mapui:transition-colors ${
                        selected
                          ? 'mapui:border-blue-500 mapui:bg-blue-50 mapui:text-blue-700'
                          : 'mapui:border-slate-300 mapui:bg-white mapui:text-slate-600 mapui:hover:border-slate-400'
                      }`}
                    >
                      {selected && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {preset.displayLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Sprite Sheets */}
            <div>
              <SpriteSourceList sprites={sprites} onChange={setSprites} />
            </div>
          </div>
        )}

        {currentStep === 'ui' && (
          <div className="mapui:space-y-4">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800">UI Options</h2>
            {effectiveUIConfig.showGlobalSearch && (
              <CollapsibleSection
                title="Global Search"
                defaultOpen={false}
                badge={globalSearch?.layers?.length ?? 0}
              >
                <GlobalSearchConfigEditor
                  value={globalSearch ?? DEFAULT_GLOBAL_SEARCH}
                  onChange={(gs) => setGlobalSearch(gs)}
                  layers={layers}
                  propertiesByLayer={queryablesByLayer}
                  isLoadingProperties={queryablesLoading}
                />
              </CollapsibleSection>
            )}
            <UIConfigEditor
              value={effectiveUIConfig}
              onChange={handleUIChange}
              autoEnabled={autoEnabledKeys}
              layers={layers}
              infoEnabled={info?.enabled ?? false}
              onInfoEnabledChange={(enabled) => {
                const current = info ?? DEFAULT_INFO;
                setInfo({ ...current, enabled });
              }}
            />
          </div>
        )}

        {currentStep === 'view' && (
          <div className="mapui:space-y-4">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800">Initial View</h2>
            <ViewEditor value={initialView} onChange={setInitialView} />
          </div>
        )}

        {currentStep === 'review' && (
          <div className="mapui:space-y-4">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-slate-800">Review & Save</h2>
            <ConfigReview
              config={assembledConfig}
              name={name}
              description={description}
              onEditSection={(step) => setCurrentStep(step as WizardStep)}
            />
            {!name && (
              <div className="mapui:rounded mapui:bg-amber-50 mapui:border mapui:border-amber-200 mapui:p-4 mapui:text-sm mapui:text-amber-800 mapui:flex mapui:items-center mapui:justify-between mapui:gap-3">
                <span>Enter a name in the <strong>Metadata</strong> step to save this map.</span>
                <button
                  type="button"
                  onClick={() => setCurrentStep('metadata')}
                  className="mapui:cursor-pointer mapui:rounded mapui:border mapui:border-amber-300 mapui:bg-white mapui:px-3 mapui:py-1 mapui:text-xs mapui:text-amber-800 hover:mapui:bg-amber-100"
                >
                  Go to Metadata
                </button>
              </div>
            )}
            <CollapsibleSection title="Edit JSON" badge="advanced">
              <p className="mapui:text-xs mapui:text-slate-500 mapui:mb-3">
                Edit the raw config JSON, or paste a full MapConfig document to replace the current state.
                Changes are validated against the schema and only applied when you click &quot;Apply Changes&quot;.
              </p>
              <JsonConfigEditor value={assembledConfig} onApply={handleReplaceConfig} />
            </CollapsibleSection>
            {lintIssues.length > 0 && (
              <div
                data-testid="wizard-lint-panel"
                className={`mapui:rounded mapui:border mapui:p-4 mapui:space-y-2 ${
                  lintErrorCount > 0
                    ? 'mapui:bg-red-50 mapui:border-red-200'
                    : 'mapui:bg-amber-50 mapui:border-amber-200'
                }`}
              >
                <p
                  className={`mapui:text-sm mapui:font-medium ${
                    lintErrorCount > 0 ? 'mapui:text-red-800' : 'mapui:text-amber-800'
                  }`}
                >
                  {lintErrorCount > 0
                    ? `${lintErrorCount} issue${lintErrorCount === 1 ? '' : 's'} blocking save:`
                    : `${lintIssues.length} warning${lintIssues.length === 1 ? '' : 's'}:`}
                </p>
                <ul className="mapui:list-none mapui:p-0 mapui:m-0 mapui:space-y-1">
                  {lintIssues.map((issue, i) => (
                    <li
                      key={i}
                      className={`mapui:flex mapui:items-start mapui:justify-between mapui:gap-2 mapui:text-sm ${
                        issue.severity === 'error' ? 'mapui:text-red-700' : 'mapui:text-amber-700'
                      }`}
                    >
                      <span>
                        <strong>{issue.path}:</strong> {issue.message}
                      </span>
                      {issue.remediation && (
                        <button
                          type="button"
                          onClick={() => applyLintRemediation(issue.remediation)}
                          className={`mapui:shrink-0 mapui:cursor-pointer mapui:rounded mapui:border mapui:bg-white mapui:px-2 mapui:py-0.5 mapui:text-xs ${
                            issue.severity === 'error'
                              ? 'mapui:border-red-300 mapui:text-red-700 hover:mapui:bg-red-100'
                              : 'mapui:border-amber-300 mapui:text-amber-800 hover:mapui:bg-amber-100'
                          }`}
                        >
                          {issue.remediation.kind === 'remove-imagery-row'
                            ? 'Remove imagery row'
                            : issue.remediation.kind === 'remove-search-field'
                            ? 'Remove field'
                            : 'Remove property'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {validationErrors.length > 0 && (
              <div className="mapui:rounded mapui:bg-red-50 mapui:border mapui:border-red-200 mapui:p-4">
                <p className="mapui:text-sm mapui:font-medium mapui:text-red-800 mapui:mb-2">Config validation failed:</p>
                <ul className="mapui:list-disc mapui:list-inside mapui:space-y-1">
                  {validationErrors.map((e, i) => (
                    <li key={i} className="mapui:text-sm mapui:text-red-700">{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {error && <p className="mapui:text-red-600 mapui:text-sm">{error}</p>}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mapui:flex mapui:justify-between mapui:items-center">
        <button
          onClick={() => setCurrentStep(STEPS[currentStepIndex - 1]?.key ?? 'metadata')}
          disabled={currentStepIndex === 0}
          className="mapui:px-4 mapui:py-2 mapui:border mapui:border-slate-300 mapui:rounded mapui:text-sm mapui:hover:bg-slate-50 mapui:disabled:opacity-50"
        >
          Previous
        </button>
        <div className="mapui:flex mapui:gap-2 mapui:items-center">
          <button
            onClick={() => setShowPreview(p => !p)}
            className="mapui:px-3 mapui:py-2 mapui:border mapui:border-blue-300 mapui:rounded mapui:text-sm mapui:text-blue-600 mapui:hover:bg-blue-50"
          >
            {showPreview ? 'Hide Preview' : 'Show Map Preview'}
          </button>
          <div className={showPreview ? 'mapui:flex mapui:gap-1' : 'mapui:hidden'}>
            <button
              onClick={() => setPreviewLayout('vertical')}
              title="Side-by-side layout"
              className={`mapui:p-1.5 mapui:rounded mapui:border ${previewLayout === 'vertical' ? 'mapui:bg-blue-100 mapui:border-blue-400 mapui:text-blue-700' : 'mapui:border-slate-300 mapui:text-slate-500 mapui:hover:bg-slate-50'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="8" height="18" rx="1"/>
                <rect x="13" y="3" width="8" height="18" rx="1"/>
              </svg>
            </button>
            <button
              onClick={() => setPreviewLayout('horizontal')}
              title="Stacked layout"
              className={`mapui:p-1.5 mapui:rounded mapui:border ${previewLayout === 'horizontal' ? 'mapui:bg-blue-100 mapui:border-blue-400 mapui:text-blue-700' : 'mapui:border-slate-300 mapui:text-slate-500 mapui:hover:bg-slate-50'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="8" rx="1"/>
                <rect x="3" y="13" width="18" height="8" rx="1"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="mapui:flex mapui:gap-2">
          {currentStepIndex < STEPS.length - 1 && (
            <button
              onClick={() => setCurrentStep(STEPS[currentStepIndex + 1].key)}
              className="mapui:bg-blue-600 mapui:text-white mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-blue-700"
            >
              Next
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || justSaved || !isConfigValid}
            title={
              !name
                ? 'Enter a name in the Metadata step to save.'
                : hasIncompleteImagery
                ? 'One or more imagery rows are missing a Source/Collection or Tile URL — fix in the Imagery step.'
                : lintErrorCount > 0
                ? `${lintErrorCount} issue${lintErrorCount === 1 ? '' : 's'} blocking save — see the Review step.`
                : !isConfigValid
                ? 'Config has validation errors — see the Review step.'
                : undefined
            }
            className={`mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:disabled:cursor-not-allowed ${
              justSaved
                ? 'mapui:bg-slate-400 mapui:text-white'
                : 'mapui:bg-green-600 mapui:text-white mapui:hover:bg-green-700 mapui:disabled:opacity-50'
            }`}
          >
            {saving ? 'Saving...' : justSaved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
        </div>
      </div>

      {/* Right: map preview (always visible on ≥md, toggle on <md) */}
      <div className={`mapui:shrink-0 mapui:border-slate-200 ${previewLayout === 'vertical' ? 'mapui:w-[45%] mapui:h-auto mapui:border-l' : 'mapui:w-full mapui:h-[400px] mapui:border-t'} ${showPreview ? 'mapui:block' : 'mapui:hidden'}`}>
        <MapPreview
          sources={sources}
          layers={previewLayers}
          imageryLayers={imageryLayers}
          basemaps={basemaps}
          sprites={sprites}
          viewState={initialView}
          onViewStateChange={currentStep === 'view' ? setInitialView : undefined}
          onLayersChange={handlePreviewLayersChange}
          onImageryLayersChange={setImageryLayers}
          currentStep={currentStep}
          uiConfig={effectiveUIConfig}
          info={info}
          globalSearch={globalSearch}
        />
      </div>
    </div>
  );
}
