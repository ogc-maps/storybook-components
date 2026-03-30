import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  SourceList,
  LayerList,
  ImageryList,
  CollectionBrowser,
  BasemapList,
  SpriteSourceList,
  UIConfigEditor,
  ViewEditor,
  ConfigPreview,
  CollapsibleSection,
  FormField,
  ColorPicker,
  detectStyleTypeForCollection,
  defaultFill,
  defaultLine,
  defaultCircle,
  defaultSymbol,
  resolveAvailableIcons,
  slugify,
} from '@ogc-maps/storybook-components';
import { safeValidateMapConfig, DEFAULT_HEADER_COLOR } from '@ogc-maps/storybook-components/schemas';
import { detectTileSourceType } from '@ogc-maps/storybook-components/utils';
import type {
  OgcApiSource,
  LayerConfig,
  ImageryLayerConfig,
  BasemapConfig,
  SpriteSource,
  UIConfig,
  ViewConfig,
  MapConfig,
  BrandingConfig,
  SourceAuth,
} from '@ogc-maps/storybook-components';
import { ImageUploadField } from '../components/ImageUploadField';
import { MapPreview } from '../components/MapPreview';

interface SavedSourceSummary { id: string; source_id: string; url: string; label: string | null; tile_matrix_set_id: string; source_type?: string; auth?: SourceAuth | null; metadata?: { thumbnail?: string; tileJson?: { tiles: string[]; name?: string; minzoom?: number; maxzoom?: number } } | null }

type WizardStep = 'metadata' | 'sources' | 'layer-select' | 'layer-config' | 'imagery' | 'basemaps' | 'ui' | 'view' | 'review';

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'metadata', label: 'Metadata' },
  { key: 'basemaps', label: 'Basemaps' },
  { key: 'sources', label: 'Sources' },
  { key: 'imagery', label: 'Imagery' },
  { key: 'layer-select', label: 'Layer selection' },
  { key: 'layer-config', label: 'Layer configuration' },
  { key: 'ui', label: 'UI' },
  { key: 'view', label: 'View' },
  { key: 'review', label: 'Review' },
];

const DEFAULT_UI_CONFIG: UIConfig = {
  showLayerPanel: true,
  showLegend: true,
  showBasemapSwitcher: true,
  showSearchPanel: false,
  showCoordinateDisplay: true,
  showFeatureDetail: true,
  showFeatureTooltip: true,
  showExportButton: true,
  showLegendOpacity: false,
  showMeasureTool: false,
  showSelectionTool: false,
  showImageryPanel: false,
};

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(true);
  const [previewLayout, setPreviewLayout] = useState<'horizontal' | 'vertical'>('vertical');

  // Branding state (single object, matches uiConfig pattern)
  const [branding, setBranding] = useState<BrandingConfig>({});
  const updateBranding = (patch: Partial<BrandingConfig>) => setBranding(prev => ({ ...prev, ...patch }));

  // Config state
  const [sources, setSources] = useState<OgcApiSource[]>([]);
  const [layers, setLayers] = useState<LayerConfig[]>([]);
  const [basemaps, setBasemaps] = useState<BasemapConfig[]>([]);
  const [sprites, setSprites] = useState<SpriteSource[]>([]);
  const [availableIcons, setAvailableIcons] = useState<string[]>([]);
  const [imageryLayers, setImageryLayers] = useState<ImageryLayerConfig[]>([]);
  const [uiConfig, setUiConfig] = useState<UIConfig>(DEFAULT_UI_CONFIG);
  const [initialView, setInitialView] = useState<ViewConfig>(DEFAULT_VIEW);

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

  // CollectionBrowser source selector state
  const [browseSourceId, setBrowseSourceId] = useState('');
  const [imageryBrowseSourceId, setImageryBrowseSourceId] = useState('');

  const isEditing = !!id;
  const currentStepIndex = STEPS.findIndex(s => s.key === currentStep);

  // Derived config object for save + preview
  const hasBranding = Object.keys(branding).length > 0;

  const assembledConfig: MapConfig = { sources, layers, ...(imageryLayers.length > 0 ? { imageryLayers } : {}), basemaps, sprites: sprites.length > 0 ? sprites : undefined, ui: uiConfig, initialView, ...(hasBranding && { branding }) };

  const isConfigValid = useMemo(() => {
    if (!name) return false;
    return safeValidateMapConfig(assembledConfig).success;
  }, [name, assembledConfig]);

  // Sync browseSourceId when sources change
  useEffect(() => {
    if (sources.length > 0 && !sources.find(s => s.id === browseSourceId)) {
      setBrowseSourceId(sources[0].id);
    }
  }, [sources, browseSourceId]);

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
          setUiConfig(data.config.ui ?? DEFAULT_UI_CONFIG);
          setInitialView(data.config.initialView ?? DEFAULT_VIEW);
          if (data.config.branding) {
            setBranding(data.config.branding);
          }
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setValidationErrors([]);

    const validation = safeValidateMapConfig(assembledConfig);
    if (!validation.success) {
      setValidationErrors(validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`));
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
      navigate('/configs');
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCollectionSelect = (collectionId: string) => {
    if (!browseSourceId) return;
    const source = sources.find(s => s.id === browseSourceId);
    if (!source) return;

    const layerId = `${browseSourceId}-${collectionId}`;
    const newLayer: LayerConfig = {
      id: layerId,
      sourceId: browseSourceId,
      collection: collectionId,
      label: collectionId,
      visible: true,
      dataMode: 'vector-tiles',
    };
    setLayers(prev => [...prev, newLayer]);

    detectStyleTypeForCollection(source.url, collectionId).then(styleType => {
      if (!styleType) return;
      const style =
        styleType === 'fill' ? defaultFill
        : styleType === 'line' ? defaultLine
        : styleType === 'symbol' ? defaultSymbol
        : defaultCircle;
      setLayers(prev => prev.map(l => l.id === layerId && !l.styles?.length ? { ...l, styles: [style] } : l));
    });
  };

  const handleCollectionDeselect = (collectionId: string) => {
    setLayers(prev =>
      prev.filter(l => !(l.sourceId === browseSourceId && l.collection === collectionId)),
    );
  };

  // Imagery collection select/deselect (mirrors layer-select pattern)
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
  const imageryBrowseSourceType = imageryBrowseSource ? detectTileSourceType(imageryBrowseSource.url) : null;
  const imagerySelectedCollectionIds = imageryLayers
    .filter(l => l.sourceId === imageryBrowseSourceId)
    .map(l => l.collection);

  // Derive filtered saved sources by type
  const savedFeatureSources = savedSources.filter(s => (s.source_type ?? 'features') === 'features');
  const savedImagerySources = savedSources.filter(s => s.source_type === 'imagery');
  const savedBasemapSources = savedSources.filter(s => s.source_type === 'basemap');
  const imageryOgcSources = sources.filter(s => s.type === 'imagery' && detectTileSourceType(s.url) === 'ogc-api');

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

  const browseSource = sources.find(s => s.id === browseSourceId);
  const selectedCollectionIds = layers
    .filter(l => l.sourceId === browseSourceId)
    .map(l => l.collection);

  if (loading) {
    return (
      <div className="mapui:flex mapui:items-center mapui:justify-center mapui:p-16 mapui:text-gray-500">
        <span className="mapui:inline-block mapui:h-6 mapui:w-6 mapui:animate-spin mapui:rounded-full mapui:border-2 mapui:border-gray-300 mapui:border-t-blue-600 mapui:mr-3" />
        Loading configuration…
      </div>
    );
  }

  return (
    <div className={`mapui:flex ${previewLayout === 'vertical' ? 'mapui:flex-row' : 'mapui:flex-col'} mapui:h-[calc(100vh-4rem)]`}>
      {/* Left: wizard form (scrollable) */}
      <div className="mapui:flex-1 mapui:min-w-0 mapui:overflow-y-auto mapui:p-8">
        <div className="mapui:max-w-3xl mapui:mx-auto">
      <h1 className="mapui:text-2xl mapui:font-bold mapui:text-gray-900 mapui:mb-6">
        {isEditing ? 'Edit Configuration' : 'Create Configuration'}
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
                : 'mapui:bg-gray-100 mapui:text-gray-500'
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
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-gray-800">Configuration Metadata</h2>
            <div>
              <label className="mapui:block mapui:text-sm mapui:font-medium mapui:text-gray-700 mapui:mb-1">
                Name <span className="mapui:text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))}
                placeholder="My-Map-Config"
                className="mapui:w-full mapui:border mapui:border-gray-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:font-mono mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
              />
              <p className="mapui:text-xs mapui:text-gray-400 mapui:mt-1">
                Letters, numbers, and hyphens (e.g. &quot;My-Map-Config&quot;)
              </p>
            </div>
            <div>
              <label className="mapui:block mapui:text-sm mapui:font-medium mapui:text-gray-700 mapui:mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe what this configuration is for..."
                rows={3}
                className="mapui:w-full mapui:border mapui:border-gray-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
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
                    className="mapui:w-full mapui:rounded mapui:border mapui:border-gray-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
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
                    className="mapui:w-full mapui:rounded mapui:border mapui:border-gray-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
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
                    className="mapui:w-24 mapui:rounded mapui:border mapui:border-gray-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
                  />
                </FormField>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {currentStep === 'sources' && (
          <div className="mapui:space-y-6">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-gray-800">OGC API Sources</h2>

            {/* Saved feature sources picker */}
            {savedFeatureSources.length > 0 && (
              <div>
                <h3 className="mapui:text-sm mapui:font-semibold mapui:text-gray-700 mapui:mb-3">Saved Feature Sources</h3>
                <div className="mapui:flex mapui:flex-wrap mapui:gap-2">
                  {savedFeatureSources.map(saved => {
                    const alreadyAdded = sources.some(s => s.id === saved.source_id);
                    return (
                      <button
                        key={saved.id}
                        type="button"
                        onClick={() => {
                          if (alreadyAdded) {
                            setSources(prev => prev.filter(s => s.id !== saved.source_id));
                            setLayers(prev => prev.filter(l => l.sourceId !== saved.source_id));
                          } else {
                            setSources(prev => [...prev, {
                              id: saved.source_id,
                              url: saved.url,
                              label: saved.label ?? undefined,
                              tileMatrixSetId: saved.tile_matrix_set_id,
                              type: 'features' as const,
                              auth: saved.auth ?? undefined,
                            }]);
                          }
                        }}
                        className={`mapui:inline-flex mapui:items-center mapui:gap-1.5 mapui:rounded-full mapui:border mapui:px-3 mapui:py-1.5 mapui:text-sm mapui:transition-colors mapui:cursor-pointer ${
                          alreadyAdded
                            ? 'mapui:border-blue-500 mapui:bg-blue-50 mapui:text-blue-700 mapui:hover:border-blue-300 mapui:hover:bg-blue-100'
                            : 'mapui:border-gray-300 mapui:bg-white mapui:text-gray-600 mapui:hover:border-blue-400 mapui:hover:bg-blue-50'
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

            {/* Inline source editor */}
            <div>
              {savedFeatureSources.length > 0 && (
                <h3 className="mapui:text-sm mapui:font-semibold mapui:text-gray-700 mapui:mb-3">All Sources</h3>
              )}
              <SourceList sources={sources} onChange={setSources} />
            </div>
          </div>
        )}

        {currentStep === 'layer-select' && (
          <div className="mapui:space-y-6">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-gray-800">Select Layers</h2>
            {sources.length === 0 ? (
              <div className="mapui:rounded mapui:bg-yellow-50 mapui:border mapui:border-yellow-200 mapui:p-4 mapui:text-sm mapui:text-yellow-800">
                No sources configured. Go back to the <strong>Sources</strong> step to add at least one OGC API source before adding layers.
              </div>
            ) : (
              <div className="mapui:space-y-4">
                {layers.length > 0 && (
                  <p className="mapui:text-sm mapui:text-gray-500">
                    {layers.length} layer{layers.length !== 1 ? 's' : ''} selected
                  </p>
                )}
                <div className="mapui:rounded mapui:border mapui:border-gray-200 mapui:p-4">
                  <h3 className="mapui:text-sm mapui:font-semibold mapui:text-gray-700 mapui:mb-3">Browse Collections</h3>
                  <div className="mapui:mb-3">
                    <label className="mapui:block mapui:text-xs mapui:font-medium mapui:text-gray-600 mapui:mb-1">
                      Source
                    </label>
                    <select
                      value={browseSourceId}
                      onChange={e => setBrowseSourceId(e.target.value)}
                      className="mapui:w-full mapui:border mapui:border-gray-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
                    >
                      {sources.filter(s => (s.type ?? 'features') !== 'imagery').map(s => (
                        <option key={s.id} value={s.id}>
                          {s.label ?? s.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  {browseSource && (
                    <CollectionBrowser
                      sourceUrl={browseSource.url}
                      sourceAuth={browseSource.auth}
                      selectedCollectionIds={selectedCollectionIds}
                      onSelect={handleCollectionSelect}
                      onDeselect={handleCollectionDeselect}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === 'layer-config' && (
          <div className="mapui:space-y-4">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-gray-800">Configure Layers</h2>
            {layers.length === 0 ? (
              <div className="mapui:rounded mapui:bg-blue-50 mapui:border mapui:border-blue-200 mapui:p-4 mapui:text-sm mapui:text-blue-800">
                No layers selected yet. Go back to the <strong>Select Layers</strong> step to choose collections.
              </div>
            ) : (
              <LayerList layers={layers} onChange={setLayers} availableSources={sources} availableIcons={availableIcons} />
            )}
          </div>
        )}

        {currentStep === 'imagery' && (
          <div className="mapui:space-y-6">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-gray-800">Imagery Layers</h2>

            {/* Saved imagery sources picker */}
            {savedImagerySources.length > 0 && (
              <div>
                <h3 className="mapui:text-sm mapui:font-semibold mapui:text-gray-700 mapui:mb-3">Saved Imagery Sources</h3>
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
                            : 'mapui:border-gray-300 mapui:bg-white mapui:text-gray-600 mapui:hover:border-purple-400 mapui:hover:bg-purple-50'
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
                      <p className="mapui:text-xs mapui:text-gray-500 mapui:mb-3">
                        Select an OGC API source and check the collections you want to add as imagery layers.
                      </p>
                      <div className="mapui:mb-3">
                        <label className="mapui:block mapui:text-xs mapui:font-medium mapui:text-gray-600 mapui:mb-1">
                          Source
                        </label>
                        <select
                          value={imageryBrowseSourceId}
                          onChange={e => setImageryBrowseSourceId(e.target.value)}
                          className="mapui:w-full mapui:border mapui:border-gray-300 mapui:rounded mapui:px-3 mapui:py-2 mapui:text-sm mapui:focus:outline-none mapui:focus:ring-2 mapui:focus:ring-blue-500"
                        >
                          <option value="">Select a source...</option>
                          {imageryOgcSources.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.label ?? s.id}
                            </option>
                          ))}
                        </select>
                      </div>
                      {imageryBrowseSource && imageryBrowseSourceType === 'ogc-api' && (
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
                      <h3 className="mapui:text-sm mapui:font-semibold mapui:text-gray-700 mapui:mb-3">
                        Configure Imagery Layers
                        <span className="mapui:ml-2 mapui:text-xs mapui:font-normal mapui:text-gray-400">
                          {imageryLayers.length} layer{imageryLayers.length !== 1 ? 's' : ''}
                        </span>
                      </h3>
                      <ImageryList
                        imageryLayers={imageryLayers}
                        onChange={setImageryLayers}
                        availableSources={sources}
                      />
                    </div>
                  )}
                </div>
          </div>
        )}

        {currentStep === 'basemaps' && (
          <div className="mapui:space-y-6">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-gray-800">Basemaps</h2>

            {/* Saved Basemap Sources */}
            {savedBasemapSources.length > 0 ? (
              <div>
                <h3 className="mapui:text-sm mapui:font-semibold mapui:text-gray-700 mapui:mb-3">Available Basemaps</h3>
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
                            : 'mapui:border-gray-200 mapui:bg-white mapui:hover:border-gray-300'
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
                          <span className="mapui:w-10 mapui:h-10 mapui:rounded-full mapui:bg-gray-300" />
                        )}
                        <span className="mapui:font-medium mapui:text-gray-700">{saved.label ?? saved.source_id}</span>
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
              <h3 className="mapui:text-sm mapui:font-semibold mapui:text-gray-700 mapui:mb-3">Preset Sprite Sheets</h3>
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
                          : 'mapui:border-gray-300 mapui:bg-white mapui:text-gray-600 mapui:hover:border-gray-400'
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
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-gray-800">UI Options</h2>
            <UIConfigEditor value={uiConfig} onChange={setUiConfig} />
          </div>
        )}

        {currentStep === 'view' && (
          <div className="mapui:space-y-4">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-gray-800">Initial View</h2>
            <ViewEditor value={initialView} onChange={setInitialView} />
          </div>
        )}

        {currentStep === 'review' && (
          <div className="mapui:space-y-4">
            <h2 className="mapui:text-lg mapui:font-semibold mapui:text-gray-800">Review & Save</h2>
            <div className="mapui:bg-gray-50 mapui:rounded mapui:p-4 mapui:text-sm mapui:text-gray-600">
              <p><strong>Name:</strong> {name || '(not set)'}</p>
              <p><strong>Description:</strong> {description || '(not set)'}</p>
            </div>
            <ConfigPreview config={assembledConfig} />
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
          className="mapui:px-4 mapui:py-2 mapui:border mapui:border-gray-300 mapui:rounded mapui:text-sm mapui:hover:bg-gray-50 mapui:disabled:opacity-50"
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
              className={`mapui:p-1.5 mapui:rounded mapui:border ${previewLayout === 'vertical' ? 'mapui:bg-blue-100 mapui:border-blue-400 mapui:text-blue-700' : 'mapui:border-gray-300 mapui:text-gray-500 mapui:hover:bg-gray-50'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="8" height="18" rx="1"/>
                <rect x="13" y="3" width="8" height="18" rx="1"/>
              </svg>
            </button>
            <button
              onClick={() => setPreviewLayout('horizontal')}
              title="Stacked layout"
              className={`mapui:p-1.5 mapui:rounded mapui:border ${previewLayout === 'horizontal' ? 'mapui:bg-blue-100 mapui:border-blue-400 mapui:text-blue-700' : 'mapui:border-gray-300 mapui:text-gray-500 mapui:hover:bg-gray-50'}`}
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
          {isConfigValid && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="mapui:bg-green-600 mapui:text-white mapui:px-4 mapui:py-2 mapui:rounded mapui:text-sm mapui:hover:bg-green-700 mapui:disabled:opacity-50 mapui:disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>
        </div>
      </div>

      {/* Right: map preview (always visible on ≥md, toggle on <md) */}
      <div className={`mapui:shrink-0 mapui:border-gray-200 ${previewLayout === 'vertical' ? 'mapui:w-[45%] mapui:h-auto mapui:border-l' : 'mapui:w-full mapui:h-[400px] mapui:border-t'} ${showPreview ? 'mapui:block' : 'mapui:hidden'}`}>
        <MapPreview
          sources={sources}
          layers={layers}
          imageryLayers={imageryLayers}
          basemaps={basemaps}
          sprites={sprites}
          viewState={initialView}
          onViewStateChange={currentStep === 'view' ? setInitialView : undefined}
          onLayersChange={setLayers}
          onImageryLayersChange={setImageryLayers}
          currentStep={currentStep}
          uiConfig={uiConfig}
        />
      </div>
    </div>
  );
}
