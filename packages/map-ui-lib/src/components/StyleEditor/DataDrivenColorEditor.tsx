import { useEffect, useRef, useState } from 'react';
import type { AvailableProperty, FetchDistinctValuesFn, CategoryGroup } from '../../types';
import { ColorPicker } from '../admin/ColorPicker';
import { getColorFromPalette } from '../../utils/colorPalettes';
import { COLOR_THEMES, COLOR_THEME_IDS, type ColorThemeId } from '../../utils/colorThemes';
import { CategoryGroupEditor } from '../CategoryGroupEditor/CategoryGroupEditor';
import { categoryGroupsToMaplibreExpression } from '../../utils/categoryGroups';

export interface DataDrivenColorEditorProps {
  value: unknown[];
  onChange: (expr: unknown[]) => void;
  availableProperties?: AvailableProperty[];
  onFetchDistinctValues?: FetchDistinctValuesFn;
  /** Optional color theme controlling autogenerate/auto-populate color selection. */
  theme?: ColorThemeId;
  /** Called when the user picks a new theme from the dropdown. */
  onThemeChange?: (theme: ColorThemeId) => void;
}

type ExprMode = 'match' | 'interpolate' | 'groups';

interface MatchPair {
  value: string;
  color: string;
}

interface InterpolateStop {
  stop: number;
  color: string;
}

interface EditableStop {
  stopText: string;
  color: string;
}

function detectMode(expr: unknown[]): ExprMode {
  if (expr[0] === 'interpolate') return 'interpolate';
  if (expr[0] === 'case') return 'groups';
  return 'match';
}

function parseMatchExpr(expr: unknown[]): { property: string; pairs: MatchPair[]; fallback: string } {
  // ["match", ["get", prop], val1, color1, ..., fallback]
  const property = Array.isArray(expr[1]) ? (expr[1][1] as string) ?? '' : '';
  const fallback = (expr[expr.length - 1] as string) ?? '#000000';
  const pairs: MatchPair[] = [];
  for (let i = 2; i < expr.length - 1; i += 2) {
    pairs.push({ value: String(expr[i] ?? ''), color: (expr[i + 1] as string) ?? '#000000' });
  }
  return { property, pairs, fallback };
}

function buildMatchExpr(property: string, pairs: MatchPair[], fallback: string): unknown[] {
  const flat: unknown[] = ['match', ['get', property]];
  for (const p of pairs) {
    flat.push(p.value, p.color);
  }
  flat.push(fallback);
  return flat;
}

function parseInterpolateExpr(expr: unknown[]): { property: string; stops: InterpolateStop[] } {
  // ["interpolate", ["linear"], ["get", prop] | ["to-number", ["get", prop]], stop1, color1, ...]
  const getter = expr[2];
  let property = '';
  if (Array.isArray(getter)) {
    if (getter[0] === 'to-number' && Array.isArray(getter[1])) {
      property = (getter[1][1] as string) ?? '';
    } else {
      property = (getter[1] as string) ?? '';
    }
  }
  const stops: InterpolateStop[] = [];
  for (let i = 3; i < expr.length; i += 2) {
    stops.push({ stop: Number(expr[i] ?? 0), color: (expr[i + 1] as string) ?? '#000000' });
  }
  return { property, stops };
}

function buildInterpolateExpr(property: string, stops: InterpolateStop[]): unknown[] {
  const flat: unknown[] = ['interpolate', ['linear'], ['to-number', ['get', property]]];
  for (const s of stops) {
    flat.push(s.stop, s.color);
  }
  return flat;
}

function stopsToEditable(stops: InterpolateStop[]): EditableStop[] {
  return stops.map((s) => ({ stopText: String(s.stop), color: s.color }));
}

function validateStops(stops: EditableStop[]): string[] {
  return stops.map((s, i) => {
    if (s.stopText.trim() === '') return 'Value required';
    const num = parseFloat(s.stopText);
    if (isNaN(num)) return 'Must be a number';
    if (i > 0) {
      const prev = parseFloat(stops[i - 1].stopText);
      if (!isNaN(prev) && num <= prev) return 'Must be greater than previous stop';
    }
    return '';
  });
}

function editableToInterpolateStops(stops: EditableStop[]): InterpolateStop[] | null {
  const result: InterpolateStop[] = [];
  for (const s of stops) {
    const num = parseFloat(s.stopText);
    if (isNaN(num)) return null;
    result.push({ stop: num, color: s.color });
  }
  return result;
}

const inputClass =
  'mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500';

const btnClass =
  'mapui:cursor-pointer mapui:rounded mapui:border mapui:border-slate-300 mapui:bg-white mapui:px-2 mapui:py-1 mapui:text-xs mapui:text-slate-700 hover:mapui:bg-slate-50';

const dangerBtnClass =
  'mapui:cursor-pointer mapui:rounded mapui:border mapui:border-red-200 mapui:bg-white mapui:px-2 mapui:py-1 mapui:text-xs mapui:text-red-600 hover:mapui:bg-red-50';

export function DataDrivenColorEditor({
  value,
  onChange,
  availableProperties = [],
  onFetchDistinctValues,
  theme,
  onThemeChange,
}: DataDrivenColorEditorProps) {
  const [mode, setMode] = useState<ExprMode>(() => detectMode(value));
  const [autoPopulating, setAutoPopulating] = useState(false);
  const [scanAll, setScanAll] = useState(false);

  // Groups mode state
  const [groupsProperty, setGroupsProperty] = useState('');
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [groupsFallback, setGroupsFallback] = useState('#cccccc');

  // Match state
  const parsed = parseMatchExpr(value);

  const matchProperty = mode === 'match' ? parsed.property : '';
  const matchPairs = mode === 'match' ? parsed.pairs : [];
  const matchFallback = mode === 'match' ? parsed.fallback : '#000000';

  // Interpolate: local editable state
  const [editableStops, setEditableStops] = useState<EditableStop[]>(() => {
    const interpolated = parseInterpolateExpr(value);
    return stopsToEditable(interpolated.stops);
  });
  const [interpolateProperty, setInterpolateProperty] = useState<string>(() => {
    return mode === 'interpolate' ? parseInterpolateExpr(value).property : '';
  });
  const [stopErrors, setStopErrors] = useState<string[]>([]);

  // Sync from prop when value changes externally (mode switch, property change from parent)
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current !== value && mode === 'interpolate') {
      const interpolated = parseInterpolateExpr(value);
      setEditableStops(stopsToEditable(interpolated.stops));
      setInterpolateProperty(interpolated.property);
      setStopErrors([]);
    }
    prevValueRef.current = value;
  }, [value, mode]);

  const stringProperties = availableProperties.filter(
    (p) => !p.type || p.type === 'string',
  );
  const numericProperties = availableProperties.filter(
    (p) => p.type === 'number' || p.type === 'integer',
  );

  // --- Match handlers ---
  const updateMatch = (
    property: string,
    pairs: MatchPair[],
    fallback: string,
  ) => {
    onChange(buildMatchExpr(property, pairs, fallback));
  };

  const handleMatchPropertyChange = (property: string) => {
    updateMatch(property, matchPairs, matchFallback);
  };

  const handleMatchFallbackChange = (color: string) => {
    updateMatch(matchProperty, matchPairs, color);
  };

  const handleMatchPairValueChange = (index: number, val: string) => {
    const next = matchPairs.map((p, i) => (i === index ? { ...p, value: val } : p));
    updateMatch(matchProperty, next, matchFallback);
  };

  const handleMatchPairColorChange = (index: number, color: string) => {
    const next = matchPairs.map((p, i) => (i === index ? { ...p, color } : p));
    updateMatch(matchProperty, next, matchFallback);
  };

  const handleMatchPairRemove = (index: number) => {
    const next = matchPairs.filter((_, i) => i !== index);
    updateMatch(matchProperty, next, matchFallback);
  };

  const handleMatchPairAdd = () => {
    const next = [...matchPairs, { value: '', color: getColorFromPalette(matchPairs.length, theme) }];
    updateMatch(matchProperty, next, matchFallback);
  };

  const handleAutoPopulate = async () => {
    if (!onFetchDistinctValues || !matchProperty) return;
    setAutoPopulating(true);
    try {
      const values = await onFetchDistinctValues(
        matchProperty,
        scanAll ? { maxFeatures: 500_000 } : undefined,
      );
      const pairs = values.map((v, i) => ({
        value: v,
        color: getColorFromPalette(i, theme),
      }));
      updateMatch(matchProperty, pairs, matchFallback);
    } finally {
      setAutoPopulating(false);
    }
  };

  // --- Interpolate handlers ---
  const propagateIfValid = (property: string, stops: EditableStop[]) => {
    const errors = validateStops(stops);
    setStopErrors(errors);
    if (property && stops.length >= 2 && errors.every((e) => !e)) {
      const parsed = editableToInterpolateStops(stops);
      if (parsed) onChange(buildInterpolateExpr(property, parsed));
    }
  };

  const handleInterpolatePropertyChange = (property: string) => {
    setInterpolateProperty(property);
    propagateIfValid(property, editableStops);
  };

  const handleEditableStopChange = (index: number, text: string) => {
    const next = editableStops.map((s, i) => (i === index ? { ...s, stopText: text } : s));
    setEditableStops(next);
    propagateIfValid(interpolateProperty, next);
  };

  const handleInterpolateStopColorChange = (index: number, color: string) => {
    const next = editableStops.map((s, i) => (i === index ? { ...s, color } : s));
    setEditableStops(next);
    propagateIfValid(interpolateProperty, next);
  };

  const handleInterpolateStopRemove = (index: number) => {
    const next = editableStops.filter((_, i) => i !== index);
    setEditableStops(next);
    propagateIfValid(interpolateProperty, next);
  };

  const handleInterpolateStopAdd = () => {
    const lastText = editableStops[editableStops.length - 1]?.stopText ?? '0';
    const lastNum = parseFloat(lastText);
    const nextStop = isNaN(lastNum) ? 0 : lastNum + 10;
    const next = [...editableStops, { stopText: String(nextStop), color: getColorFromPalette(editableStops.length) }];
    setEditableStops(next);
    propagateIfValid(interpolateProperty, next);
  };

  // --- Groups handlers ---
  const handleGroupsPropertyChange = (property: string) => {
    setGroupsProperty(property);
    if (groups.length > 0 && property) {
      onChange(categoryGroupsToMaplibreExpression(groups, property, groupsFallback));
    }
  };

  const handleGroupsChange = (nextGroups: CategoryGroup[]) => {
    setGroups(nextGroups);
    if (groupsProperty) {
      onChange(categoryGroupsToMaplibreExpression(nextGroups, groupsProperty, groupsFallback));
    }
  };

  const handleGroupsFallbackChange = (color: string) => {
    setGroupsFallback(color);
    if (groupsProperty) {
      onChange(categoryGroupsToMaplibreExpression(groups, groupsProperty, color));
    }
  };

  // --- Mode switch ---
  const handleModeSwitch = (newMode: ExprMode) => {
    setMode(newMode);
    if (newMode === 'match') {
      onChange(buildMatchExpr('', [], '#000000'));
    } else if (newMode === 'interpolate') {
      setEditableStops([]);
      setInterpolateProperty('');
      setStopErrors([]);
      onChange(buildInterpolateExpr('', []));
    } else {
      setGroups([]);
      setGroupsProperty('');
      setGroupsFallback('#cccccc');
      onChange(['case', '#cccccc']);
    }
  };

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-2">
      {onThemeChange && (
        <div className="mapui:flex mapui:items-center mapui:gap-2">
          <label className="mapui:text-xs mapui:text-slate-600 mapui:shrink-0">Color theme:</label>
          <select
            value={theme ?? 'default'}
            onChange={(e) => onThemeChange(e.target.value as ColorThemeId)}
            className={`${inputClass} mapui:flex-1`}
            aria-label="Autogenerate color theme"
          >
            {COLOR_THEME_IDS.map((id) => (
              <option key={id} value={id}>
                {COLOR_THEMES[id].label} — {COLOR_THEMES[id].description}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Mode toggle */}
      <div className="mapui:flex mapui:overflow-hidden mapui:rounded mapui:border mapui:border-slate-300">
        {([['match', 'Categorical'], ['groups', 'Groups'], ['interpolate', 'Gradient']] as [ExprMode, string][]).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => handleModeSwitch(m)}
            className={[
              'mapui:flex-1 mapui:cursor-pointer mapui:border-0 mapui:px-3 mapui:py-1 mapui:text-xs mapui:outline-none',
              'focus:mapui:ring-1 focus:mapui:ring-inset focus:mapui:ring-blue-400',
              mode === m
                ? 'mapui:bg-blue-500 mapui:text-white'
                : 'mapui:bg-white mapui:text-slate-700 hover:mapui:bg-slate-50',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'match' && (
        <>
          {/* Property selector */}
          <select
            value={matchProperty}
            onChange={(e) => handleMatchPropertyChange(e.target.value)}
            className={inputClass}
          >
            <option value="">Select a property…</option>
            {stringProperties.map((p) => (
              <option key={p.name} value={p.name}>
                {p.title ?? p.name}
              </option>
            ))}
          </select>

          {/* Value → color pairs */}
          {matchPairs.length > 0 && (
            <div className="mapui:flex mapui:flex-col mapui:gap-1">
              {matchPairs.map((pair, i) => (
                <div key={i} className="mapui:flex mapui:items-center mapui:gap-2">
                  <input
                    type="text"
                    value={pair.value}
                    onChange={(e) => handleMatchPairValueChange(i, e.target.value)}
                    placeholder="value"
                    className={`${inputClass} mapui:flex-1`}
                  />
                  <ColorPicker
                    value={pair.color}
                    onChange={(c) => handleMatchPairColorChange(i, c)}
                    label={`Color for "${pair.value}"`}
                  />
                  <button type="button" onClick={() => handleMatchPairRemove(i)} className={dangerBtnClass}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Fallback color */}
          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <span className="mapui:text-xs mapui:text-slate-500 mapui:shrink-0">Fallback:</span>
            <ColorPicker value={matchFallback} onChange={handleMatchFallbackChange} label="Fallback color" />
          </div>

          {/* Buttons */}
          <div className="mapui:flex mapui:gap-2">
            <button type="button" onClick={handleMatchPairAdd} className={btnClass}>
              + Add value
            </button>
            {onFetchDistinctValues && matchProperty && (
              <>
                <button
                  type="button"
                  onClick={handleAutoPopulate}
                  disabled={autoPopulating}
                  className={btnClass}
                >
                  {autoPopulating ? 'Loading…' : 'Auto-populate'}
                </button>
                <label className="mapui:flex mapui:items-center mapui:gap-1 mapui:text-xs mapui:text-slate-600">
                  <input
                    type="checkbox"
                    checked={scanAll}
                    onChange={(e) => setScanAll(e.target.checked)}
                    className="mapui:h-3 mapui:w-3"
                  />
                  Scan all features
                </label>
              </>
            )}
          </div>
        </>
      )}

      {mode === 'groups' && (
        <>
          <select
            value={groupsProperty}
            onChange={(e) => handleGroupsPropertyChange(e.target.value)}
            className={inputClass}
          >
            <option value="">Select a property…</option>
            {stringProperties.map((p) => (
              <option key={p.name} value={p.name}>
                {p.title ?? p.name}
              </option>
            ))}
          </select>
          <CategoryGroupEditor
            groups={groups}
            onGroupsChange={handleGroupsChange}
            availableValues={[]}
          />
          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <span className="mapui:text-xs mapui:text-slate-500 mapui:shrink-0">Fallback:</span>
            <ColorPicker value={groupsFallback} onChange={handleGroupsFallbackChange} label="Fallback color" />
          </div>
        </>
      )}

      {mode === 'interpolate' && (
        <>
          {/* Property selector */}
          <select
            value={interpolateProperty}
            onChange={(e) => handleInterpolatePropertyChange(e.target.value)}
            className={inputClass}
          >
            <option value="">Select a numeric property…</option>
            {numericProperties.map((p) => (
              <option key={p.name} value={p.name}>
                {p.title ?? p.name}
              </option>
            ))}
          </select>

          {/* Stops */}
          {editableStops.length > 0 && (
            <div className="mapui:flex mapui:flex-col mapui:gap-1">
              {editableStops.map((s, i) => {
                const error = stopErrors[i];
                return (
                  <div key={i} className="mapui:flex mapui:flex-col mapui:gap-0.5">
                    <div className="mapui:flex mapui:items-center mapui:gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={s.stopText}
                        onChange={(e) => handleEditableStopChange(i, e.target.value)}
                        placeholder="stop"
                        className={`${inputClass} mapui:w-24`}
                      />
                      <ColorPicker
                        value={s.color}
                        onChange={(c) => handleInterpolateStopColorChange(i, c)}
                        label={`Color at stop ${s.stopText}`}
                      />
                      <button type="button" onClick={() => handleInterpolateStopRemove(i)} className={dangerBtnClass}>
                        ×
                      </button>
                    </div>
                    {error && <span className="mapui:text-xs mapui:text-red-500">{error}</span>}
                  </div>
                );
              })}
            </div>
          )}

          <button type="button" onClick={handleInterpolateStopAdd} className={btnClass}>
            + Add stop
          </button>
        </>
      )}
    </div>
  );
}
