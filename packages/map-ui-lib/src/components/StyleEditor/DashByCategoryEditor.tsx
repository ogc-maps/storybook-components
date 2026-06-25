import { useEffect, useMemo, useRef, useState } from 'react';
import type { AvailableProperty, DashByCategory, FetchDistinctValuesFn } from '../../types';
import { inputClass } from '../Cql2FilterEditor/styles';

export interface DashByCategoryEditorProps {
  value?: DashByCategory;
  onChange: (next: DashByCategory | undefined) => void;
  availableProperties?: AvailableProperty[];
  /** Optional fetcher used to auto-populate distinct case values. */
  onFetchDistinctValues?: FetchDistinctValuesFn;
}

const DEFAULT_DASH_PRESETS: { label: string; dasharray: number[] }[] = [
  { label: 'Solid', dasharray: [1, 0] },
  { label: 'Long dash', dasharray: [4, 2] },
  { label: 'Short dash', dasharray: [2, 2] },
  { label: 'Dotted', dasharray: [1, 2] },
  { label: 'Dash-dot', dasharray: [4, 2, 1, 2] },
];

function parseDasharray(raw: string): number[] | null {
  const parts = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return nums;
}

function dasharrayToString(da: number[]): string {
  return da.join(', ');
}

/**
 * Editor for `LineStyle.dashByCategory` — per-category dash array.
 *
 * **Design note.** MapLibre data-constants `line-dasharray`, so this can't
 * be expressed as a paint expression. The renderer in `MapContainer` /
 * `MapPreview` expands a layer with `dashByCategory` into one
 * `<Layer>` per case, each carrying a static dasharray plus a filter
 * `["==", ["get", property], value]`. See `expandDashByCategory`.
 */
export function DashByCategoryEditor({
  value,
  onChange,
  availableProperties,
  onFetchDistinctValues,
}: DashByCategoryEditorProps) {
  const stringProps = useMemo(
    () => (availableProperties ?? []).filter((p) => p.type === 'string' || p.type === 'integer' || p.type === 'number'),
    [availableProperties],
  );

  const [autoPopulating, setAutoPopulating] = useState(false);
  const lastFetchedRef = useRef<string | null>(null);

  // Keep latest onChange in a ref so the auto-fetch effect doesn't need it as a dep.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Auto-fetch distinct values once when property changes, only if cases is empty.
  // NOTE: this effect must run on every render (Rules of Hooks), so it lives
  // ABOVE the `if (!value)` early return. The body no-ops when value is absent.
  useEffect(() => {
    if (!value || !onFetchDistinctValues || !value.property) return;
    if (value.cases.length > 0) return;
    if (lastFetchedRef.current === value.property) return;
    lastFetchedRef.current = value.property;
    setAutoPopulating(true);
    const property = value.property;
    const existingCases = value.cases;
    void (async () => {
      try {
        const distinct = await onFetchDistinctValues(property);
        const existing = new Map(existingCases.map((c) => [String(c.value), c.dasharray]));
        const cases = distinct.map((v) => ({
          value: v,
          dasharray: existing.get(v) ?? DEFAULT_DASH_PRESETS[0].dasharray,
        }));
        onChangeRef.current({ property, cases });
      } finally {
        setAutoPopulating(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.property, value?.cases.length, onFetchDistinctValues]);

  if (!value) {
    return (
      <div className="mapui:flex mapui:flex-col mapui:items-start mapui:gap-1">
        <p className="mapui:m-0 mapui:text-xs mapui:text-slate-500">
          Drive `line-dasharray` from a feature property. MapLibre doesn't accept expressions for
          dasharray, so each case is rendered as its own sub-layer.
        </p>
        <button
          type="button"
          onClick={() =>
            onChange({
              property: stringProps[0]?.name ?? '',
              cases: [{ value: '', dasharray: [4, 2] }],
            })
          }
          className="mapui:cursor-pointer mapui:rounded mapui:border mapui:border-slate-300 mapui:bg-white mapui:px-2 mapui:py-1 mapui:text-xs mapui:text-slate-700 hover:mapui:bg-slate-50"
        >
          + Dash by category
        </button>
      </div>
    );
  }

  const updateProperty = (property: string) => onChange({ ...value, property });
  const updateCase = (i: number, patch: Partial<DashByCategory['cases'][number]>) => {
    const cases = value.cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChange({ ...value, cases });
  };
  const removeCase = (i: number) => {
    const cases = value.cases.filter((_, idx) => idx !== i);
    onChange({ ...value, cases });
  };
  const addCase = () => {
    onChange({ ...value, cases: [...value.cases, { value: '', dasharray: [4, 2] }] });
  };

  const handleAutoPopulate = async () => {
    if (!onFetchDistinctValues || !value.property) return;
    setAutoPopulating(true);
    try {
      const distinct = await onFetchDistinctValues(value.property);
      lastFetchedRef.current = value.property;
      // Preserve existing case dasharrays where the case value still exists.
      const existing = new Map(value.cases.map((c) => [String(c.value), c.dasharray]));
      const cases = distinct.map((v) => ({
        value: v,
        dasharray: existing.get(v) ?? DEFAULT_DASH_PRESETS[(0)].dasharray,
      }));
      onChange({ ...value, cases });
    } finally {
      setAutoPopulating(false);
    }
  };

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-2 mapui:rounded mapui:border mapui:border-amber-200 mapui:bg-amber-50 mapui:p-2">
      <div className="mapui:flex mapui:items-center mapui:justify-between mapui:gap-2">
        <span className="mapui:text-xs mapui:font-semibold mapui:uppercase mapui:tracking-wide mapui:text-amber-800">
          Dash by category
        </span>
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="mapui:cursor-pointer mapui:text-xs mapui:text-red-600 hover:mapui:underline"
        >
          Remove
        </button>
      </div>

      <div className="mapui:flex mapui:items-center mapui:gap-2">
        <label className="mapui:text-xs mapui:text-slate-600 mapui:w-16">Property</label>
        {stringProps.length > 0 ? (
          <select
            value={value.property}
            onChange={(e) => updateProperty(e.target.value)}
            className={inputClass}
          >
            <option value="">Property...</option>
            {stringProps.map((p) => (
              <option key={p.name} value={p.name}>
                {p.title ?? p.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value.property}
            onChange={(e) => updateProperty(e.target.value)}
            placeholder="property"
            className={inputClass}
          />
        )}
        {onFetchDistinctValues && value.property && (
          <button
            type="button"
            onClick={handleAutoPopulate}
            disabled={autoPopulating}
            className="mapui:cursor-pointer mapui:rounded mapui:border mapui:border-slate-300 mapui:bg-white mapui:px-2 mapui:py-0.5 mapui:text-xs mapui:text-slate-700 hover:mapui:bg-slate-50 disabled:mapui:opacity-50"
            title={`Re-fetch distinct values from ${value.property}`}
          >
            {autoPopulating ? '…' : 'Auto-populate'}
          </button>
        )}
      </div>

      <div className="mapui:flex mapui:flex-col mapui:gap-1">
        {value.cases.map((c, i) => (
          <DashCaseRow
            key={i}
            caseValue={c.value}
            dasharray={c.dasharray}
            onChange={(patch) => updateCase(i, patch)}
            onRemove={() => removeCase(i)}
          />
        ))}
        <button
          type="button"
          onClick={addCase}
          className="mapui:cursor-pointer mapui:self-start mapui:rounded mapui:border mapui:border-dashed mapui:border-slate-300 mapui:px-2 mapui:py-0.5 mapui:text-xs mapui:text-slate-600 hover:mapui:border-amber-400 hover:mapui:text-amber-700"
        >
          + Add case
        </button>
      </div>

      <div className="mapui:flex mapui:items-center mapui:gap-2">
        <label className="mapui:text-xs mapui:text-slate-600 mapui:w-16">Default</label>
        <input
          type="text"
          value={value.default ? dasharrayToString(value.default) : ''}
          placeholder="Optional, e.g. 1, 4 (features matching no case)"
          onChange={(e) => {
            const parsed = parseDasharray(e.target.value);
            onChange({ ...value, default: parsed && parsed.length > 0 ? parsed : undefined });
          }}
          className={inputClass}
        />
      </div>
    </div>
  );
}

function DashCaseRow({
  caseValue,
  dasharray,
  onChange,
  onRemove,
}: {
  caseValue: string | number;
  dasharray: number[];
  onChange: (patch: Partial<{ value: string | number; dasharray: number[] }>) => void;
  onRemove: () => void;
}) {
  const [raw, setRaw] = useState(dasharrayToString(dasharray));
  useEffect(() => {
    setRaw(dasharrayToString(dasharray));
  }, [dasharray]);

  const commitDash = () => {
    const parsed = parseDasharray(raw);
    if (parsed && parsed.length > 0) {
      onChange({ dasharray: parsed });
      setRaw(dasharrayToString(parsed));
    } else {
      // Invalid — revert to last known good
      setRaw(dasharrayToString(dasharray));
    }
  };

  return (
    <div className="mapui:flex mapui:flex-wrap mapui:items-center mapui:gap-1">
      <input
        type="text"
        value={String(caseValue)}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="value"
        className={`${inputClass} mapui:w-32`}
      />
      <input
        type="text"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commitDash}
        placeholder="2, 4"
        className={`${inputClass} mapui:w-32`}
        title="Dasharray: comma- or space-separated lengths in pixels"
      />
      <select
        value=""
        onChange={(e) => {
          const preset = DEFAULT_DASH_PRESETS.find((p) => p.label === e.target.value);
          if (preset) onChange({ dasharray: preset.dasharray });
        }}
        className={inputClass}
        title="Apply preset"
      >
        <option value="">Preset…</option>
        {DEFAULT_DASH_PRESETS.map((p) => (
          <option key={p.label} value={p.label}>
            {p.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        className="mapui:cursor-pointer mapui:rounded mapui:p-1 mapui:text-slate-400 hover:mapui:bg-red-50 hover:mapui:text-red-500"
        title="Remove case"
      >
        ×
      </button>
    </div>
  );
}
