import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AvailableProperty, FetchDistinctValuesFn } from '../../types';
import type { CategoricalMatchType } from '../../utils/expressionColors';
import {
  buildInterpolateExpression,
  buildMatchExpression,
  parseInterpolateExpression,
  parseMatchExpression,
  type MatchPair,
} from '../../utils/dataDrivenExpressions';

export type ExprMode = 'match' | 'interpolate';

export type MatchPairContext = 'pair' | 'stop' | 'fallback';

export interface RenderOutputCellArgs<TOutput> {
  value: TOutput;
  onChange: (v: TOutput) => void;
  context: MatchPairContext;
  rowIndex: number;
}

export interface DataDrivenExpressionEditorProps<TOutput> {
  value: unknown[];
  onChange: (expr: unknown[]) => void;
  availableProperties?: AvailableProperty[];
  /** Which modes are selectable. When length is 1 the mode toggle is hidden. */
  supportedModes: ExprMode[];
  /** Turn a raw value from a parsed expression (string, number, ...) into the editor's TOutput. */
  parseOutput: (raw: unknown) => TOutput;
  /** Serialize a TOutput back into the expression array form. */
  serializeOutput: (v: TOutput) => unknown;
  /** Output cell renderer (color picker / number input / icon picker). */
  renderOutputCell: (args: RenderOutputCellArgs<TOutput>) => ReactNode;
  /** Default output used for newly added pairs/stops and initial fallback. */
  defaultOutput: (rowIndex: number, context: MatchPairContext) => TOutput;
  /** Optional side panel rendered above the mode toggle (e.g. color theme selector). */
  sidePanel?: ReactNode;
  /** If provided, an Auto-populate button is shown in match mode. */
  onFetchDistinctValues?: FetchDistinctValuesFn;
  /** Maps fetched distinct values to outputs for auto-populate. Required with onFetchDistinctValues. */
  autoPopulateOutputs?: (values: string[]) => TOutput[];
  /** Labels for the mode toggle buttons. */
  matchModeLabel?: string;
  interpolateModeLabel?: string;
  /**
   * When provided, a "Hidden / none" checkbox is shown alongside the fallback
   * cell. Checking it sets the fallback to this value (e.g. a fully transparent
   * color), so features matching no category render nothing while keeping a
   * valid expression. Comparison is by serialized equality.
   */
  fallbackHiddenValue?: TOutput;
}

interface EditableStop<TOutput> {
  stopText: string;
  output: TOutput;
}

function detectMode(expr: unknown[]): ExprMode {
  return expr[0] === 'interpolate' ? 'interpolate' : 'match';
}

function validateStops<TOutput>(stops: EditableStop<TOutput>[]): string[] {
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

const inputClass =
  'mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500';

const btnClass =
  'mapui:cursor-pointer mapui:rounded mapui:border mapui:border-slate-300 mapui:bg-white mapui:px-2 mapui:py-1 mapui:text-xs mapui:text-slate-700 hover:mapui:bg-slate-50';

const dangerBtnClass =
  'mapui:cursor-pointer mapui:rounded mapui:border mapui:border-red-200 mapui:bg-white mapui:px-2 mapui:py-1 mapui:text-xs mapui:text-red-600 hover:mapui:bg-red-50';

export function DataDrivenExpressionEditor<TOutput>({
  value,
  onChange,
  availableProperties = [],
  supportedModes,
  parseOutput,
  serializeOutput,
  renderOutputCell,
  defaultOutput,
  sidePanel,
  onFetchDistinctValues,
  autoPopulateOutputs,
  matchModeLabel = 'Categorical',
  interpolateModeLabel = 'Gradient',
  fallbackHiddenValue,
}: DataDrivenExpressionEditorProps<TOutput>) {
  const initialMode = supportedModes.includes(detectMode(value)) ? detectMode(value) : supportedModes[0];
  const [mode, setMode] = useState<ExprMode>(initialMode);
  const [autoPopulating, setAutoPopulating] = useState(false);
  const [scanAll, setScanAll] = useState(false);

  const defaultFallback = defaultOutput(0, 'fallback');
  const parsed = parseMatchExpression(value, parseOutput, defaultFallback);
  const matchProperty = mode === 'match' ? parsed.property : '';
  const matchPairs = mode === 'match' ? parsed.pairs : [];
  const matchFallback = mode === 'match' ? parsed.fallback : defaultFallback;

  const [editableStops, setEditableStops] = useState<EditableStop<TOutput>[]>(() => {
    const interpolated = parseInterpolateExpression(value, parseOutput);
    return interpolated.stops.map((s) => ({ stopText: String(s.stop), output: s.output }));
  });
  const [interpolateProperty, setInterpolateProperty] = useState<string>(() => {
    return mode === 'interpolate' ? parseInterpolateExpression(value, parseOutput).property : '';
  });
  const [stopErrors, setStopErrors] = useState<string[]>([]);

  // Remembers the last non-hidden fallback so unchecking "Hidden / none" restores it.
  const lastVisibleFallbackRef = useRef<TOutput | null>(null);

  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current !== value && mode === 'interpolate') {
      const interpolated = parseInterpolateExpression(value, parseOutput);
      setEditableStops(interpolated.stops.map((s) => ({ stopText: String(s.stop), output: s.output })));
      setInterpolateProperty(interpolated.property);
      setStopErrors([]);
    }
    prevValueRef.current = value;
  }, [value, mode, parseOutput]);

  const stringProperties = availableProperties.filter((p) => !p.type || p.type === 'string');
  const numericProperties = availableProperties.filter((p) => p.type === 'number' || p.type === 'integer');

  const updateMatch = (property: string, pairs: MatchPair<TOutput>[], fallback: TOutput) => {
    onChange(buildMatchExpression(property, pairs, fallback, serializeOutput));
  };

  const handleMatchPropertyChange = (property: string) => updateMatch(property, matchPairs, matchFallback);
  const handleMatchFallbackChange = (output: TOutput) => updateMatch(matchProperty, matchPairs, output);
  const handleMatchPairValueChange = (index: number, val: string) => {
    const next = matchPairs.map((p, i) => (i === index ? { ...p, value: val } : p));
    updateMatch(matchProperty, next, matchFallback);
  };
  const handleMatchPairOutputChange = (index: number, output: TOutput) => {
    const next = matchPairs.map((p, i) => (i === index ? { ...p, output } : p));
    updateMatch(matchProperty, next, matchFallback);
  };
  const handleMatchPairTypeChange = (index: number, matchType: CategoricalMatchType) => {
    const next = matchPairs.map((p, i) => (i === index ? { ...p, matchType } : p));
    updateMatch(matchProperty, next, matchFallback);
  };
  const handleMatchPairRemove = (index: number) => {
    const next = matchPairs.filter((_, i) => i !== index);
    updateMatch(matchProperty, next, matchFallback);
  };
  const handleMatchPairAdd = () => {
    const next: MatchPair<TOutput>[] = [
      ...matchPairs,
      { value: '', output: defaultOutput(matchPairs.length, 'pair'), matchType: 'equals' },
    ];
    updateMatch(matchProperty, next, matchFallback);
  };

  const handleAutoPopulate = async () => {
    if (!onFetchDistinctValues || !autoPopulateOutputs || !matchProperty) return;
    setAutoPopulating(true);
    try {
      const values = await onFetchDistinctValues(matchProperty, scanAll ? { maxFeatures: 500_000 } : undefined);
      const outputs = autoPopulateOutputs(values);
      const pairs: MatchPair<TOutput>[] = values.map((v, i) => ({
        value: v,
        output: outputs[i],
        matchType: 'equals',
      }));
      updateMatch(matchProperty, pairs, matchFallback);
    } finally {
      setAutoPopulating(false);
    }
  };

  const propagateIfValid = (property: string, stops: EditableStop<TOutput>[]) => {
    const errors = validateStops(stops);
    setStopErrors(errors);
    if (property && stops.length >= 2 && errors.every((e) => !e)) {
      const parsed: { stop: number; output: TOutput }[] = stops.map((s) => ({
        stop: parseFloat(s.stopText),
        output: s.output,
      }));
      onChange(buildInterpolateExpression(property, parsed, serializeOutput));
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
  const handleInterpolateStopOutputChange = (index: number, output: TOutput) => {
    const next = editableStops.map((s, i) => (i === index ? { ...s, output } : s));
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
    const next = [
      ...editableStops,
      { stopText: String(nextStop), output: defaultOutput(editableStops.length, 'stop') },
    ];
    setEditableStops(next);
    propagateIfValid(interpolateProperty, next);
  };

  const handleModeSwitch = (newMode: ExprMode) => {
    if (!supportedModes.includes(newMode)) return;
    setMode(newMode);
    if (newMode === 'match') {
      onChange(buildMatchExpression('', [], defaultOutput(0, 'fallback'), serializeOutput));
    } else {
      setEditableStops([]);
      setInterpolateProperty('');
      setStopErrors([]);
      onChange(buildInterpolateExpression('', [], serializeOutput));
    }
  };

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-2">
      {sidePanel}

      {supportedModes.length > 1 && (
        <div className="mapui:flex mapui:overflow-hidden mapui:rounded mapui:border mapui:border-slate-300">
          {supportedModes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleModeSwitch(m)}
              className={[
                'mapui:flex-1 mapui:cursor-pointer mapui:border-0 mapui:px-3 mapui:py-1 mapui:text-xs mapui:capitalize mapui:outline-none',
                'focus:mapui:ring-1 focus:mapui:ring-inset focus:mapui:ring-blue-400',
                mode === m
                  ? 'mapui:bg-blue-500 mapui:text-white'
                  : 'mapui:bg-white mapui:text-slate-700 hover:mapui:bg-slate-50',
              ].join(' ')}
            >
              {m === 'match' ? matchModeLabel : interpolateModeLabel}
            </button>
          ))}
        </div>
      )}

      {mode === 'match' && (
        <>
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

          {matchPairs.length > 0 && (
            <div className="mapui:flex mapui:flex-col mapui:gap-1">
              {matchPairs.map((pair, i) => (
                <div key={i} className="mapui:flex mapui:items-center mapui:gap-2">
                  <select
                    value={pair.matchType}
                    onChange={(e) => handleMatchPairTypeChange(i, e.target.value as CategoricalMatchType)}
                    className={`${inputClass} mapui:shrink-0`}
                    aria-label="Match type"
                  >
                    <option value="equals">Equals</option>
                    <option value="contains">Contains</option>
                  </select>
                  <input
                    type="text"
                    value={pair.value}
                    onChange={(e) => handleMatchPairValueChange(i, e.target.value)}
                    placeholder={pair.matchType === 'contains' ? 'substring' : 'value'}
                    className={`${inputClass} mapui:flex-1`}
                  />
                  {renderOutputCell({
                    value: pair.output,
                    onChange: (out) => handleMatchPairOutputChange(i, out),
                    context: 'pair',
                    rowIndex: i,
                  })}
                  <button type="button" onClick={() => handleMatchPairRemove(i)} className={dangerBtnClass}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <span className="mapui:text-xs mapui:text-slate-500 mapui:shrink-0">Fallback:</span>
            {(() => {
              const isHidden =
                fallbackHiddenValue !== undefined &&
                serializeOutput(matchFallback) === serializeOutput(fallbackHiddenValue);
              return (
                <>
                  {!isHidden &&
                    renderOutputCell({
                      value: matchFallback,
                      onChange: handleMatchFallbackChange,
                      context: 'fallback',
                      rowIndex: -1,
                    })}
                  {fallbackHiddenValue !== undefined && (
                    <label className="mapui:flex mapui:items-center mapui:gap-1 mapui:text-xs mapui:text-slate-600">
                      <input
                        type="checkbox"
                        checked={isHidden}
                        onChange={(e) => {
                          if (e.target.checked) {
                            lastVisibleFallbackRef.current = matchFallback;
                            handleMatchFallbackChange(fallbackHiddenValue);
                          } else {
                            handleMatchFallbackChange(
                              lastVisibleFallbackRef.current ?? defaultOutput(0, 'fallback'),
                            );
                          }
                        }}
                        className="mapui:h-3 mapui:w-3"
                      />
                      Hidden / none
                    </label>
                  )}
                </>
              );
            })()}
          </div>

          <div className="mapui:flex mapui:gap-2">
            <button type="button" onClick={handleMatchPairAdd} className={btnClass}>
              + Add value
            </button>
            {onFetchDistinctValues && autoPopulateOutputs && matchProperty && (
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

      {mode === 'interpolate' && (
        <>
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
                      {renderOutputCell({
                        value: s.output,
                        onChange: (out) => handleInterpolateStopOutputChange(i, out),
                        context: 'stop',
                        rowIndex: i,
                      })}
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
