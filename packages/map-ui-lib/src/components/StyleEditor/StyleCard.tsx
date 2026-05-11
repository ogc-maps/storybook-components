import { useState } from 'react';
import type { StyleConfig, AvailableProperty, FetchDistinctValuesFn } from '../../types';
import { StyleEditor } from './StyleEditor';

const STYLE_TYPE_LABELS: Record<StyleConfig['type'], string> = {
  fill: 'Fill',
  line: 'Line',
  circle: 'Circle',
  symbol: 'Symbol',
};

export interface StyleCardProps {
  style: StyleConfig;
  index: number;
  onChange: (s: StyleConfig) => void;
  onRemove?: () => void;
  defaultOpen?: boolean;
  suggestedTypes?: StyleConfig['type'][];
  availableIcons?: string[];
  availableProperties?: AvailableProperty[];
  onFetchDistinctValues?: FetchDistinctValuesFn;
}

export function StyleCard({
  style,
  index,
  onChange,
  onRemove,
  defaultOpen = false,
  suggestedTypes,
  availableIcons,
  availableProperties,
  onFetchDistinctValues,
}: StyleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const label = `Style ${index + 1} · ${STYLE_TYPE_LABELS[style.type]}`;

  return (
    <div className="mapui:rounded mapui:border mapui:border-slate-200 mapui:bg-slate-50">
      <div className="mapui:flex mapui:items-center mapui:gap-1 mapui:px-3 mapui:py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mapui:flex mapui:min-w-0 mapui:flex-1 mapui:cursor-pointer mapui:items-center mapui:gap-2 mapui:border-0 mapui:bg-transparent mapui:p-0 mapui:text-left mapui:outline-none"
        >
          <span className="mapui:truncate mapui:text-sm mapui:font-medium mapui:text-slate-700">
            {label}
          </span>
          <span className="mapui:ml-2 mapui:shrink-0 mapui:text-xs mapui:text-slate-400">
            {open ? '▲' : '▼'}
          </span>
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove style"
            className="mapui:ml-1 mapui:shrink-0 mapui:cursor-pointer mapui:rounded mapui:border-0 mapui:bg-transparent mapui:px-1.5 mapui:py-0.5 mapui:text-xs mapui:text-red-500 hover:mapui:bg-red-50 hover:mapui:text-red-700"
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div className="mapui:border-t mapui:border-slate-200 mapui:p-3">
          <StyleEditor
            value={style}
            onChange={onChange}
            suggestedTypes={suggestedTypes}
            availableIcons={availableIcons}
            availableProperties={availableProperties}
            onFetchDistinctValues={onFetchDistinctValues}
          />
        </div>
      )}
    </div>
  );
}
