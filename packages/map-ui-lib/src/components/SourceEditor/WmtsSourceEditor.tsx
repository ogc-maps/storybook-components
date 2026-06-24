import { useEffect, useState } from 'react';
import type { WmtsSource, SourceAuth } from '../../types';
import { FormField } from '../admin/FormField';
import { useWmtsCapabilities } from '../../hooks/useWmtsCapabilities';
import { resolveWmtsTileUrlTemplate } from '../../utils/wmts';

export interface WmtsSourceEditorProps {
  value: WmtsSource;
  onChange: (source: WmtsSource) => void;
}

const inputClass =
  'mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500';

export function WmtsSourceEditor({ value, onChange }: WmtsSourceEditorProps) {
  const update = (patch: Partial<WmtsSource>) => onChange({ ...value, ...patch });
  const authType = value.auth?.type ?? 'none';
  const [fetchUrl, setFetchUrl] = useState<string | null>(null);

  const { capabilities, loading: capLoading, error: capError } = useWmtsCapabilities(
    fetchUrl,
    value.auth,
  );

  const selectedLayer = capabilities?.layers.find((l) => l.id === value.layer);

  // Once capabilities are loaded, resolve the layer's advertised tile ResourceURL
  // into a concrete `tileUrlTemplate` (filling {TileMatrixSet}/{Style}/{Time}/…).
  // The renderer prefers this over hand-building the URL. When capabilities aren't
  // loaded (editing an existing source before "Fetch Layers"), leave any stored
  // template untouched. Intentionally omits `value.tileUrlTemplate`/`onChange` from
  // deps — the equality guard prevents an update loop.
  useEffect(() => {
    if (!selectedLayer) return;
    const resolved = resolveWmtsTileUrlTemplate(selectedLayer, {
      style: value.style,
      tileMatrixSet: value.tileMatrixSet,
      format: value.format,
    });
    if (resolved && resolved !== value.tileUrlTemplate) {
      update({ tileUrlTemplate: resolved });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayer, value.style, value.tileMatrixSet, value.format]);

  // Selecting a layer also snaps style/tileMatrixSet/format to that layer's
  // advertised values when the current ones aren't valid for it — otherwise the
  // resolved tile URL would carry a default (e.g. WebMercatorQuad) the layer
  // doesn't serve, producing 404s.
  const selectLayer = (layerId: string) => {
    const layer = capabilities?.layers.find((l) => l.id === layerId);
    if (!layer) {
      update({ layer: layerId });
      return;
    }
    // Keep the current value if the layer still offers it, else snap to the
    // layer's first advertised option (falling back to the current value when
    // the layer advertises none).
    const pick = (current: string, options: string[]) =>
      options.includes(current) ? current : options[0] ?? current;
    update({
      layer: layerId,
      style: pick(value.style, layer.styles),
      tileMatrixSet: pick(value.tileMatrixSet, layer.tileMatrixSets),
      format: pick(value.format, layer.formats),
    });
  };

  const handleAuthTypeChange = (newType: string) => {
    if (newType === 'none') {
      update({ auth: undefined });
    } else {
      update({
        auth: {
          type: newType as SourceAuth['type'],
          name: value.auth?.name ?? '',
          value: value.auth?.value ?? '',
        },
      });
    }
  };

  const updateAuth = (patch: Partial<SourceAuth>) => {
    if (!value.auth) return;
    update({ auth: { ...value.auth, ...patch } });
  };

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-3">
      <FormField label="ID" required>
        <input
          type="text"
          value={value.id}
          onChange={(e) => update({ id: e.target.value })}
          placeholder="nasa-gibs"
          className={inputClass}
        />
      </FormField>

      <FormField label="Label">
        <input
          type="text"
          value={value.label ?? ''}
          onChange={(e) => update({ label: e.target.value || undefined })}
          placeholder="NASA GIBS"
          className={inputClass}
        />
      </FormField>

      <FormField label="GetCapabilities URL" required>
        <div className="mapui:flex mapui:gap-2">
          <input
            type="url"
            value={value.capabilitiesUrl}
            onChange={(e) => update({ capabilitiesUrl: e.target.value })}
            placeholder="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
            className={`${inputClass} mapui:flex-1`}
          />
          <button
            type="button"
            onClick={() => setFetchUrl(value.capabilitiesUrl)}
            disabled={capLoading || !value.capabilitiesUrl}
            className="mapui:cursor-pointer mapui:rounded mapui:border mapui:border-blue-500 mapui:bg-white mapui:px-3 mapui:py-1 mapui:text-sm mapui:text-blue-600 hover:mapui:bg-blue-50 disabled:mapui:cursor-not-allowed disabled:mapui:opacity-50"
          >
            {capLoading ? 'Loading…' : 'Fetch Layers'}
          </button>
        </div>
        {capError && (
          <p className="mapui:mt-1 mapui:text-xs mapui:text-red-600">{capError.message}</p>
        )}
      </FormField>

      <FormField label="Layer" required>
        {capabilities ? (
          <select
            value={value.layer}
            onChange={(e) => selectLayer(e.target.value)}
            className={`${inputClass} mapui:w-full`}
          >
            <option value="">— Select a layer —</option>
            {capabilities.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title ?? l.id}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value.layer}
            onChange={(e) => update({ layer: e.target.value })}
            placeholder="MODIS_Terra_CorrectedReflectance_TrueColor"
            className={inputClass}
          />
        )}
      </FormField>

      <FormField label="Style">
        {selectedLayer?.styles.length ? (
          <select
            value={value.style}
            onChange={(e) => update({ style: e.target.value })}
            className={`${inputClass} mapui:w-full`}
          >
            {selectedLayer.styles.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value.style}
            onChange={(e) => update({ style: e.target.value })}
            placeholder="default"
            className={inputClass}
          />
        )}
      </FormField>

      <FormField label="Tile Matrix Set">
        {selectedLayer?.tileMatrixSets.length ? (
          <select
            value={value.tileMatrixSet}
            onChange={(e) => update({ tileMatrixSet: e.target.value })}
            className={`${inputClass} mapui:w-full`}
          >
            {selectedLayer.tileMatrixSets.map((tms) => (
              <option key={tms} value={tms}>
                {tms}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value.tileMatrixSet}
            onChange={(e) => update({ tileMatrixSet: e.target.value })}
            placeholder="WebMercatorQuad"
            className={inputClass}
          />
        )}
      </FormField>

      <FormField label="Format">
        {selectedLayer?.formats.length ? (
          <select
            value={value.format}
            onChange={(e) => update({ format: e.target.value })}
            className={`${inputClass} mapui:w-full`}
          >
            {selectedLayer.formats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value.format}
            onChange={(e) => update({ format: e.target.value })}
            placeholder="image/png"
            className={inputClass}
          />
        )}
      </FormField>

      <FormField label="Tile Size (px)">
        <input
          type="number"
          value={value.tileSize}
          onChange={(e) => update({ tileSize: Number(e.target.value) || 256 })}
          placeholder="256"
          className={inputClass}
        />
      </FormField>

      <FormField label="Authentication">
        <select
          value={authType}
          onChange={(e) => handleAuthTypeChange(e.target.value)}
          className={`${inputClass} mapui:w-full`}
        >
          <option value="none">None</option>
          <option value="query_param">Query Parameter</option>
          <option value="header">HTTP Header</option>
        </select>
      </FormField>

      {value.auth && (
        <div className="mapui:grid mapui:grid-cols-2 mapui:gap-3">
          <FormField
            label={authType === 'header' ? 'Header Name' : 'Parameter Name'}
            required
          >
            <input
              type="text"
              value={value.auth.name}
              onChange={(e) => updateAuth({ name: e.target.value })}
              placeholder={authType === 'header' ? 'Authorization' : 'key'}
              className={inputClass}
            />
          </FormField>
          <FormField label="Value" required>
            <input
              type="text"
              value={value.auth.value}
              onChange={(e) => updateAuth({ value: e.target.value })}
              placeholder={authType === 'header' ? 'Bearer your-token' : 'your-api-key'}
              className={inputClass}
            />
          </FormField>
        </div>
      )}

      <FormField label="Proxy">
        <label className="mapui:flex mapui:items-center mapui:gap-2 mapui:cursor-pointer">
          <input
            type="checkbox"
            checked={value.proxy ?? false}
            onChange={() => update({ proxy: !value.proxy })}
            className="mapui:accent-blue-600"
          />
          <span className="mapui:text-sm mapui:text-slate-700">
            Proxy requests through server
          </span>
        </label>
      </FormField>
    </div>
  );
}
