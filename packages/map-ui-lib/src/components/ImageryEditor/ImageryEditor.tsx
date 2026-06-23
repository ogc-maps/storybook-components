import { useState, useRef } from 'react';
import type { ImageryLayerConfig, MapSource, SourceAuth } from '../../types';
import { useOgcCollections } from '../../hooks/useOgcCollections';
import { fetchGenericTileJson, tileSizeFromTileJson, detectTileSourceType } from '../../utils/ogcApi';
import { isWmtsSource } from '../../utils/wmts';
import { FormField } from '../admin/FormField';
import { slugify } from '../../utils/slugify';

export interface ImageryEditorProps {
  value: ImageryLayerConfig;
  onChange: (layer: ImageryLayerConfig) => void;
  availableSources?: MapSource[];
  /** Resolved base URL for the selected source — enables collection dropdown */
  sourceUrl?: string;
  /** Auth config for the selected source — passed to collection fetching */
  sourceAuth?: SourceAuth;
}

const inputClass =
  'mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500';

export function ImageryEditor({
  value,
  onChange,
  availableSources = [],
  sourceUrl,
  sourceAuth,
}: ImageryEditorProps) {
  const update = (patch: Partial<ImageryLayerConfig>) => onChange({ ...value, ...patch });

  const selectedSource = availableSources.find((s) => s.id === value.sourceId);
  const selectedWmtsSource = selectedSource && isWmtsSource(selectedSource) ? selectedSource : null;

  const isCustomUrl = value.tileUrlTemplate != null;
  const { collections, loading: collectionsLoading } = useOgcCollections(
    !isCustomUrl && sourceUrl ? sourceUrl : null,
    sourceAuth,
  );

  const [tileJsonLoading, setTileJsonLoading] = useState(false);
  const [tileJsonError, setTileJsonError] = useState<string | null>(null);
  const fetchGeneration = useRef(0);

  const handleCollectionChange = (collectionId: string) => {
    const col = collections.find((c) => c.id === collectionId);
    const patch: Partial<ImageryLayerConfig> = { collection: collectionId };
    if (!value.label || value.label === 'New Imagery Layer' || value.label === value.collection) {
      patch.label = col?.title ?? collectionId;
    }
    if (!value.id || value.id === `${value.sourceId}-${value.collection}`) {
      patch.id = `${value.sourceId}-${collectionId}`;
    }
    update(patch);
  };

  const toggleCustomUrl = (useCustom: boolean) => {
    setTileJsonError(null);
    if (useCustom) {
      update({ tileUrlTemplate: '', collection: '' });
    } else {
      update({ tileUrlTemplate: undefined });
    }
  };

  const handleCustomUrlChange = async (url: string) => {
    setTileJsonError(null);

    const urlType = url ? detectTileSourceType(url) : null;

    if (urlType === 'tilejson') {
      const generation = ++fetchGeneration.current;
      setTileJsonLoading(true);
      try {
        const tj = await fetchGenericTileJson(url, sourceAuth);
        if (generation !== fetchGeneration.current) return; // stale response
        const tileSize = tileSizeFromTileJson(tj);
        const patch: Partial<ImageryLayerConfig> = { tileUrlTemplate: tj.tiles?.[0] ?? url, tileSize };
        if (tj.name && (!value.label || value.label === 'Custom Imagery Layer' || value.label === 'New Imagery Layer')) {
          patch.label = tj.name;
        }
        if (tj.minzoom != null) patch.minZoom = tj.minzoom;
        if (tj.maxzoom != null) patch.maxZoom = tj.maxzoom;
        if (!value.id && tj.name) patch.id = slugify(tj.name);
        update(patch);
      } catch (err) {
        if (generation !== fetchGeneration.current) return;
        update({ tileUrlTemplate: url });
        setTileJsonError(err instanceof Error ? err.message : 'Failed to fetch TileJSON');
      } finally {
        if (generation === fetchGeneration.current) setTileJsonLoading(false);
      }
    } else if (urlType === 'style') {
      setTileJsonError('Style URLs belong in the Basemaps tab — use "Style URL" mode there.');
      update({ tileUrlTemplate: undefined });
      return;
    } else {
      // XYZ or unknown — use as-is
      const patch: Partial<ImageryLayerConfig> = { tileUrlTemplate: url || undefined };
      if (!value.id && value.label && value.label !== 'Custom Imagery Layer' && value.label !== 'New Imagery Layer') {
        patch.id = slugify(value.label);
      }
      update(patch);
    }
  };

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-3">
      <FormField label="Label">
        <input
          type="text"
          value={value.label}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="MapTiler Satellite"
          className={`${inputClass} mapui:w-full`}
        />
      </FormField>

      {/* Mode toggle: OGC Collection vs Custom URL */}
      <div className="mapui:flex mapui:gap-4 mapui:text-sm">
        <label className="mapui:flex mapui:items-center mapui:gap-1.5 mapui:cursor-pointer">
          <input
            type="radio"
            checked={!isCustomUrl}
            onChange={() => toggleCustomUrl(false)}
            className="mapui:accent-blue-600"
          />
          <span className="mapui:text-slate-700">OGC Collection</span>
        </label>
        <label className="mapui:flex mapui:items-center mapui:gap-1.5 mapui:cursor-pointer">
          <input
            type="radio"
            checked={isCustomUrl}
            onChange={() => toggleCustomUrl(true)}
            className="mapui:accent-blue-600"
          />
          <span className="mapui:text-slate-700">Custom Tile URL</span>
        </label>
      </div>

      {isCustomUrl ? (
        <>
          <FormField
            label="Tile URL or TileJSON Endpoint"
            required
            description="Enter a {z}/{x}/{y} tile URL or a TileJSON endpoint (tiles.json). TileJSON URLs are auto-resolved."
          >
            <input
              type="text"
              value={value.tileUrlTemplate ?? ''}
              onChange={(e) => update({ tileUrlTemplate: e.target.value || undefined })}
              onBlur={(e) => {
                const url = e.target.value.trim();
                if (url && detectTileSourceType(url) === 'tilejson') {
                  handleCustomUrlChange(url);
                }
              }}
              onPaste={(e) => {
                // Auto-resolve on paste for TileJSON URLs
                setTimeout(() => {
                  const url = (e.target as HTMLInputElement).value.trim();
                  if (url && detectTileSourceType(url) === 'tilejson') {
                    handleCustomUrlChange(url);
                  }
                }, 0);
              }}
              placeholder="https://api.maptiler.com/tiles/satellite/tiles.json?key=YOUR_KEY"
              className={`${inputClass} mapui:w-full`}
            />
          </FormField>
          {tileJsonLoading && (
            <div className="mapui:flex mapui:items-center mapui:gap-2 mapui:text-sm mapui:text-slate-500">
              <span className="mapui:inline-block mapui:h-3 mapui:w-3 mapui:animate-spin mapui:rounded-full mapui:border-2 mapui:border-slate-300 mapui:border-t-blue-600" />
              Resolving TileJSON…
            </div>
          )}
          {tileJsonError && (
            <p className="mapui:text-sm mapui:text-red-600">{tileJsonError}</p>
          )}

          {/* Source selector (optional for custom URL layers) */}
          {availableSources.length > 0 && (
            <FormField label="Source (optional)" description="Attach to a source for auth. Leave empty for standalone layers.">
              <select
                value={value.sourceId}
                onChange={(e) => update({ sourceId: e.target.value })}
                className={`${inputClass} mapui:w-full`}
              >
                <option value="">None</option>
                {availableSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label ?? s.id}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </>
      ) : (
        <>
          {/* Source selector (required for OGC mode) */}
          <FormField label="Source">
            {availableSources.length > 0 ? (
              <select
                value={value.sourceId}
                onChange={(e) => update({ sourceId: e.target.value })}
                className={`${inputClass} mapui:w-full`}
              >
                <option value="">Select a source...</option>
                {availableSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label ?? s.id}
                    {isWmtsSource(s) ? ' (WMTS)' : s.type === 'imagery' ? ' (Imagery)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={value.sourceId}
                onChange={(e) => update({ sourceId: e.target.value })}
                placeholder="source-id"
                className={inputClass}
              />
            )}
          </FormField>

          {selectedWmtsSource ? (
            <p className="mapui:rounded mapui:border mapui:border-slate-200 mapui:bg-slate-50 mapui:px-3 mapui:py-2 mapui:text-xs mapui:text-slate-600">
              WMTS source — serves layer{' '}
              <span className="mapui:font-medium mapui:text-slate-800">
                {selectedWmtsSource.layer}
              </span>
              . No collection needed.
            </p>
          ) : (
          <FormField label="Collection" required>
            {sourceUrl && collections.length > 0 ? (
              <select
                value={value.collection}
                onChange={(e) => handleCollectionChange(e.target.value)}
                className={`${inputClass} mapui:w-full`}
              >
                <option value="">Select a collection...</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title ?? c.id}
                  </option>
                ))}
              </select>
            ) : collectionsLoading ? (
              <div className="mapui:flex mapui:items-center mapui:gap-2 mapui:text-sm mapui:text-slate-500 mapui:py-1">
                <span className="mapui:inline-block mapui:h-3 mapui:w-3 mapui:animate-spin mapui:rounded-full mapui:border-2 mapui:border-slate-300 mapui:border-t-blue-600" />
                Loading collections…
              </div>
            ) : (
              <input
                type="text"
                value={value.collection}
                onChange={(e) => update({ collection: e.target.value })}
                placeholder="GOESEastCONUSGeoColor"
                className={`${inputClass} mapui:w-full`}
              />
            )}
          </FormField>
          )}
        </>
      )}

      <div className="mapui:grid mapui:grid-cols-2 mapui:gap-3">
        <FormField label="Opacity">
          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={value.opacity ?? 1}
              onChange={(e) => update({ opacity: Number(e.target.value) })}
              className="mapui:flex-1 mapui:cursor-pointer mapui:accent-blue-600"
            />
            <span className="mapui:text-xs mapui:text-slate-500 mapui:w-8 mapui:text-right">
              {Math.round((value.opacity ?? 1) * 100)}%
            </span>
          </div>
        </FormField>

        <FormField label="Tile Size">
          <input
            type="number"
            min={64}
            max={1024}
            step={64}
            value={value.tileSize ?? 256}
            onChange={(e) => update({ tileSize: Number(e.target.value) })}
            className={`${inputClass} mapui:w-24`}
          />
        </FormField>
      </div>

      <FormField
        label="Thumbnail URL"
        description="Optional preview image shown next to this layer in the imagery panel."
      >
        <input
          type="text"
          value={value.thumbnailUrl ?? ''}
          onChange={(e) => update({ thumbnailUrl: e.target.value || undefined })}
          placeholder="https://example.com/thumb.png"
          className={`${inputClass} mapui:w-full`}
        />
      </FormField>

      <div className="mapui:grid mapui:grid-cols-2 mapui:gap-3">
        <FormField label="Min Zoom">
          <input
            type="number"
            min={0}
            max={24}
            value={value.minZoom ?? ''}
            onChange={(e) => update({ minZoom: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="0"
            className={`${inputClass} mapui:w-24`}
          />
        </FormField>

        <FormField label="Max Zoom">
          <input
            type="number"
            min={0}
            max={24}
            value={value.maxZoom ?? ''}
            onChange={(e) => update({ maxZoom: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="24"
            className={`${inputClass} mapui:w-24`}
          />
        </FormField>
      </div>

      <div className="mapui:flex mapui:flex-col mapui:gap-3">
        <label className="mapui:flex mapui:items-center mapui:gap-2 mapui:cursor-pointer">
          <input
            type="checkbox"
            checked={value.visible}
            onChange={(e) => update({ visible: e.target.checked })}
            className="mapui:h-4 mapui:w-4 mapui:cursor-pointer mapui:accent-blue-600"
          />
          <span className="mapui:text-sm mapui:text-slate-700">Initially visible</span>
        </label>

        <label className="mapui:flex mapui:items-center mapui:gap-2 mapui:cursor-pointer">
          <input
            type="checkbox"
            checked={value.exclusive}
            onChange={(e) => update({ exclusive: e.target.checked })}
            className="mapui:h-4 mapui:w-4 mapui:cursor-pointer mapui:accent-blue-600"
          />
          <div className="mapui:flex mapui:flex-col">
            <span className="mapui:text-sm mapui:text-slate-700">Exclusive mode</span>
            <span className="mapui:text-xs mapui:text-slate-400">
              Enabling this layer disables other imagery layers
            </span>
          </div>
        </label>
      </div>
    </div>
  );
}
