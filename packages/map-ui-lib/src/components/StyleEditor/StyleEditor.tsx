import { useState, useEffect } from 'react';
import type { StyleConfig, FillStyle, LineStyle, CircleStyle, SymbolStyle, AvailableProperty, FetchDistinctValuesFn } from '../../types';
import { FormField } from '../admin/FormField';
import { PropertyGroup } from './PropertyGroup';
import { StylePreview } from './StylePreview';
import { getPropertyRegistry, groupProperties } from './propertyRegistry';
import type { ColorThemeId } from '../../utils/colorThemes';

export interface StyleEditorProps {
  value: StyleConfig;
  onChange: (style: StyleConfig) => void;
  suggestedType?: 'fill' | 'line' | 'circle' | 'symbol' | null;
  suggestedTypes?: StyleConfig['type'][];
  availableIcons?: string[];
  availableProperties?: AvailableProperty[];
  onFetchDistinctValues?: FetchDistinctValuesFn;
  /** Optional color theme that scopes autogenerate color selection. */
  colorTheme?: ColorThemeId;
  onColorThemeChange?: (theme: ColorThemeId) => void;
}

export const defaultFill: FillStyle = {
  type: 'fill',
  paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.6, 'fill-outline-color': 'transparent', 'fill-antialias': true },
};

export const defaultLine: LineStyle = {
  type: 'line',
  paint: { 'line-color': '#2980b9', 'line-width': 2, 'line-opacity': 1 },
};

export const defaultCircle: CircleStyle = {
  type: 'circle',
  paint: { 'circle-color': '#e74c3c', 'circle-radius': 5, 'circle-opacity': 0.9 },
};

export const defaultSymbol: SymbolStyle = {
  type: 'symbol',
  paint: { 'text-color': '#333333' },
  layout: { 'text-field': '{name}', 'text-size': 14 },
};

const defaultSymbolIcon: SymbolStyle = {
  type: 'symbol',
  paint: { 'icon-color': '#000000' },
  layout: { 'icon-image': '' },
};

type SymbolMode = 'text' | 'icon' | 'both';

function deriveSymbolMode(value: StyleConfig): SymbolMode {
  if (value.type !== 'symbol') return 'text';
  const layout = (value as { layout?: Record<string, unknown> }).layout ?? {};
  const hasIcon = 'icon-image' in layout;
  const hasText = 'text-field' in layout;
  if (hasIcon && hasText) return 'both';
  if (hasIcon) return 'icon';
  return 'text';
}

const inputClass =
  'mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500';

const STYLE_TYPE_LABELS: Record<StyleConfig['type'], string> = {
  fill: 'Fill',
  line: 'Line',
  circle: 'Circle',
  symbol: 'Symbol',
};

const SYMBOL_MODES: SymbolMode[] = ['text', 'icon', 'both'];

export function StyleEditor({ value, onChange, suggestedType, suggestedTypes, availableIcons, availableProperties, onFetchDistinctValues, colorTheme, onColorThemeChange }: StyleEditorProps) {
  // Normalise: prefer suggestedTypes array; fall back to legacy suggestedType scalar
  const resolvedSuggestedTypes: StyleConfig['type'][] =
    suggestedTypes ?? (suggestedType ? [suggestedType] : []);
  const [symbolMode, setSymbolMode] = useState<SymbolMode>(() => deriveSymbolMode(value));

  // Re-derive symbolMode when the style type changes externally
  useEffect(() => {
    setSymbolMode(deriveSymbolMode(value));
  }, [value.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTypeChange = (type: StyleConfig['type']) => {
    if (type === 'fill') onChange(defaultFill);
    else if (type === 'line') onChange(defaultLine);
    else if (type === 'circle') onChange(defaultCircle);
    else onChange(defaultSymbol);
  };

  const handleSymbolModeChange = (mode: SymbolMode) => {
    if (mode === symbolMode) return;

    const currentPaint = (value.paint ?? {}) as Record<string, unknown>;
    const currentLayout = ((value as { layout?: Record<string, unknown> }).layout ?? {}) as Record<string, unknown>;

    let newPaint = { ...currentPaint };
    let newLayout = { ...currentLayout };

    if (mode === 'icon') {
      // Remove all text-* properties, keep symbol-* (Placement)
      newPaint = Object.fromEntries(Object.entries(newPaint).filter(([k]) => !k.startsWith('text-')));
      newLayout = Object.fromEntries(Object.entries(newLayout).filter(([k]) => !k.startsWith('text-')));
      // Set icon-image if not already present
      if (!('icon-image' in newLayout)) {
        newLayout['icon-image'] = defaultSymbolIcon.layout!['icon-image'];
      }
    } else if (mode === 'text') {
      // Remove all icon-* properties, keep symbol-* (Placement)
      newPaint = Object.fromEntries(Object.entries(newPaint).filter(([k]) => !k.startsWith('icon-')));
      newLayout = Object.fromEntries(Object.entries(newLayout).filter(([k]) => !k.startsWith('icon-')));
      // Set text defaults if not already present
      if (!('text-field' in newLayout)) newLayout['text-field'] = '{name}';
      if (!('text-size' in newLayout)) newLayout['text-size'] = 14;
      if (!('text-color' in newPaint)) newPaint['text-color'] = '#333333';
    }
    // mode === 'both': no property cleanup, just show all groups

    setSymbolMode(mode);
    onChange({
      ...value,
      paint: newPaint,
      layout: Object.keys(newLayout).length > 0 ? newLayout : undefined,
    } as StyleConfig);
  };

  const handlePaintChange = (key: string, val: unknown) => {
    const newPaint = { ...value.paint, [key]: val } as Record<string, unknown>;
    for (const k of Object.keys(newPaint)) {
      if (newPaint[k] === undefined) delete newPaint[k];
    }
    onChange({ ...value, paint: newPaint } as StyleConfig);
  };

  const handleLayoutChange = (key: string, val: unknown) => {
    const currentLayout = (value as { layout?: Record<string, unknown> }).layout ?? {};
    const newLayout = { ...currentLayout, [key]: val };
    // Remove undefined keys
    for (const k of Object.keys(newLayout)) {
      if (newLayout[k] === undefined) delete newLayout[k];
    }
    onChange({
      ...value,
      layout: Object.keys(newLayout).length > 0 ? newLayout : undefined,
    } as StyleConfig);
  };

  let allDefs = getPropertyRegistry(value.type);

  // Filter property definitions by symbol mode
  if (value.type === 'symbol') {
    if (symbolMode === 'text') {
      allDefs = allDefs.filter((d) => !d.key.startsWith('icon-'));
    } else if (symbolMode === 'icon') {
      allDefs = allDefs.filter((d) => !d.key.startsWith('text-'));
    }
    // 'both': no filter — symbol-* (Placement) properties are always shown since they don't start with 'icon-' or 'text-'
  }

  const paintDefs = allDefs.filter((d) => d.category === 'paint');
  const layoutDefs = allDefs.filter((d) => d.category === 'layout');

  const paintGroups = groupProperties(paintDefs);
  const layoutGroups = groupProperties(layoutDefs);

  const paintValues = value.paint as Record<string, unknown>;
  const layoutValues = ((value as { layout?: Record<string, unknown> }).layout ?? {}) as Record<string, unknown>;

  // First group name (usually "Appearance") defaults to open
  const paintGroupNames = Object.keys(paintGroups);
  const layoutGroupNames = Object.keys(layoutGroups);

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-3">
      {resolvedSuggestedTypes.length > 0 && !resolvedSuggestedTypes.includes(value.type) && (
        <div className="mapui:flex mapui:items-center mapui:justify-between mapui:rounded mapui:border mapui:border-blue-200 mapui:bg-blue-50 mapui:px-3 mapui:py-2 mapui:text-sm mapui:text-blue-800">
          <span>
            Detected geometry is suitable for{' '}
            {resolvedSuggestedTypes.map((t, i) => (
              <span key={t}>
                {i > 0 && (i === resolvedSuggestedTypes.length - 1 ? ' or ' : ', ')}
                <strong>{STYLE_TYPE_LABELS[t]}</strong>
              </span>
            ))}{' '}
            style.
          </span>
          <div className="mapui:flex mapui:gap-1">
            {resolvedSuggestedTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleTypeChange(t)}
                className="mapui:cursor-pointer mapui:rounded mapui:border mapui:border-blue-400 mapui:bg-white mapui:px-2 mapui:py-0.5 mapui:text-xs mapui:text-blue-700 hover:mapui:bg-blue-100"
              >
                {STYLE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      <FormField label="Style Type">
        <select
          value={value.type}
          onChange={(e) => handleTypeChange(e.target.value as StyleConfig['type'])}
          className={inputClass}
        >
          {(Object.keys(STYLE_TYPE_LABELS) as StyleConfig['type'][]).map((t) => (
            <option key={t} value={t}>
              {STYLE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </FormField>

      {value.type === 'symbol' && (
        <FormField label="Symbol Mode">
          <div className="mapui:flex mapui:overflow-hidden mapui:rounded mapui:border mapui:border-slate-300">
            {SYMBOL_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleSymbolModeChange(mode)}
                className={[
                  'mapui:flex-1 mapui:cursor-pointer mapui:border-0 mapui:px-3 mapui:py-1 mapui:text-sm mapui:capitalize mapui:outline-none',
                  'focus:mapui:ring-1 focus:mapui:ring-inset focus:mapui:ring-blue-400',
                  symbolMode === mode
                    ? 'mapui:bg-blue-500 mapui:text-white'
                    : 'mapui:bg-white mapui:text-slate-700 hover:mapui:bg-slate-50',
                ].join(' ')}
              >
                {mode === 'both' ? 'Both' : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </FormField>
      )}

      <div className="mapui:rounded mapui:border mapui:border-slate-100 mapui:p-2">
        <p className="mapui:m-0 mapui:mb-1 mapui:text-xs mapui:text-slate-500">Preview</p>
        <StylePreview style={value} />
      </div>

      {paintGroupNames.length > 0 && (
        <div className="mapui:flex mapui:flex-col mapui:gap-2">
          <p className="mapui:m-0 mapui:text-xs mapui:font-medium mapui:uppercase mapui:tracking-wide mapui:text-slate-500">
            Appearance
          </p>
          {paintGroupNames.map((groupName, i) => (
            <PropertyGroup
              key={groupName}
              title={groupName}
              properties={paintGroups[groupName]}
              values={paintValues}
              onChange={handlePaintChange}
              defaultOpen={i === 0}
              availableIcons={availableIcons}
              availableProperties={availableProperties}
              onFetchDistinctValues={onFetchDistinctValues}
              colorTheme={colorTheme}
              onColorThemeChange={onColorThemeChange}
            />
          ))}
        </div>
      )}

      {layoutGroupNames.length > 0 && (
        <div className="mapui:flex mapui:flex-col mapui:gap-2">
          <p className="mapui:m-0 mapui:text-xs mapui:font-medium mapui:uppercase mapui:tracking-wide mapui:text-slate-500">
            Layout
          </p>
          {layoutGroupNames.map((groupName) => (
            <PropertyGroup
              key={groupName}
              title={groupName}
              properties={layoutGroups[groupName]}
              values={layoutValues}
              onChange={handleLayoutChange}
              defaultOpen={false}
              availableIcons={availableIcons}
              availableProperties={availableProperties}
              onFetchDistinctValues={onFetchDistinctValues}
              colorTheme={colorTheme}
              onColorThemeChange={onColorThemeChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
