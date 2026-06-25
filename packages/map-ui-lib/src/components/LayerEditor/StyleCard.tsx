import type { ReactNode } from 'react';
import type { StyleConfig } from '../../types';
import { StylePreview } from '../StyleEditor/StylePreview';

export interface StyleCardProps {
  index: number;
  style: StyleConfig;
  onRemove?: () => void;
  /** Move this style one slot earlier in the layer's styles array (undefined/disabled at the top). */
  onMoveUp?: () => void;
  /** Move this style one slot later in the layer's styles array (undefined/disabled at the bottom). */
  onMoveDown?: () => void;
  /** Whether this card is the first in the list (disables the up button). */
  isFirst?: boolean;
  /** Whether this card is the last in the list (disables the down button). */
  isLast?: boolean;
  children: ReactNode;
}

type StyleType = StyleConfig['type'];

const TYPE_VISUAL: Record<StyleType, { headerBg: string; label: string }> = {
  fill: { headerBg: 'mapui:bg-sky-50', label: 'Fill' },
  line: { headerBg: 'mapui:bg-teal-50', label: 'Line' },
  circle: { headerBg: 'mapui:bg-orange-50', label: 'Circle' },
  symbol: { headerBg: 'mapui:bg-violet-50', label: 'Symbol' },
};

function TypeIcon({ type }: { type: StyleType }) {
  const box = 'mapui:flex mapui:h-3 mapui:w-3 mapui:items-center mapui:justify-center mapui:shrink-0';
  if (type === 'fill') {
    return <span className={box}><span className="mapui:h-3 mapui:w-3 mapui:rounded-sm mapui:bg-sky-400" /></span>;
  }
  if (type === 'line') {
    return <span className={box}><span className="mapui:h-0.5 mapui:w-3 mapui:bg-teal-500" /></span>;
  }
  if (type === 'circle') {
    return <span className={box}><span className="mapui:h-2 mapui:w-2 mapui:rounded-full mapui:bg-orange-400" /></span>;
  }
  return (
    <span className={`${box} mapui:text-[10px] mapui:font-bold mapui:leading-none mapui:text-violet-600`}>
      A
    </span>
  );
}

export function StyleCard({
  index,
  style,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  children,
}: StyleCardProps) {
  const visual = TYPE_VISUAL[style.type];
  const filterChips = style.geometryFilter ?? [];

  return (
    <div className="mapui:overflow-hidden mapui:rounded-md mapui:border mapui:border-slate-200 mapui:bg-white">
      <div
        className={`mapui:flex mapui:items-center mapui:gap-2 mapui:border-b mapui:border-slate-200 mapui:px-3 mapui:py-2 mapui:text-xs ${visual.headerBg}`}
      >
        <TypeIcon type={style.type} />
        <span className="mapui:font-semibold mapui:text-slate-700">{visual.label}</span>
        <span className="mapui:text-slate-400">#{index + 1}</span>
        {filterChips.length > 0 && (
          <span className="mapui:flex mapui:flex-wrap mapui:gap-1">
            {filterChips.map((g) => (
              <span
                key={g}
                className="mapui:rounded mapui:bg-indigo-100 mapui:px-1.5 mapui:py-0.5 mapui:text-[10px] mapui:font-medium mapui:text-indigo-700"
              >
                {g}
              </span>
            ))}
          </span>
        )}
        <span className="mapui:ml-auto mapui:flex mapui:items-center mapui:gap-2">
          <span className="mapui:w-20 mapui:shrink-0">
            <StylePreview style={style} />
          </span>
          {(onMoveUp || onMoveDown) && (
            <span className="mapui:flex mapui:flex-col mapui:gap-0.5">
              <button
                type="button"
                onClick={onMoveUp}
                disabled={isFirst || !onMoveUp}
                aria-label="Move style up"
                title="Move style up"
                className="mapui:cursor-pointer mapui:rounded mapui:border-none mapui:bg-transparent mapui:px-1 mapui:text-[10px] mapui:leading-none mapui:text-slate-400 hover:mapui:text-slate-600 disabled:mapui:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={isLast || !onMoveDown}
                aria-label="Move style down"
                title="Move style down"
                className="mapui:cursor-pointer mapui:rounded mapui:border-none mapui:bg-transparent mapui:px-1 mapui:text-[10px] mapui:leading-none mapui:text-slate-400 hover:mapui:text-slate-600 disabled:mapui:opacity-30"
              >
                ▼
              </button>
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove style"
              title="Remove style"
              className="mapui:flex mapui:h-6 mapui:w-6 mapui:cursor-pointer mapui:items-center mapui:justify-center mapui:rounded mapui:border-0 mapui:bg-transparent mapui:text-base mapui:leading-none mapui:text-slate-400 mapui:transition-colors hover:mapui:bg-white hover:mapui:text-red-600"
            >
              ×
            </button>
          )}
        </span>
      </div>
      <div className="mapui:p-3">{children}</div>
    </div>
  );
}
