import { useState } from 'react';
import type { CSSProperties } from 'react';
import { LuMaximize2, LuMinimize2 } from 'react-icons/lu';
import { MdOutlineKeyboardArrowRight, MdOutlineKeyboardArrowDown } from 'react-icons/md';
import type { LayerConfig, LegendConfig, LegendDisplayConfig, LegendEntry } from '../../types';

export interface LegendProps {
  layers: LayerConfig[];
  visibleLayerIds: string[];
  /**
   * Optional explicit legend display order (array of layer IDs). IDs in this
   * list render first, in order; any visible legend layers not listed follow
   * in their natural order. Unknown IDs are ignored.
   */
  legendOrder?: string[];
  /**
   * Optional global presentation overrides for the legend panel chrome
   * (background, text, border colors). Per-entry colors live on each
   * `LegendEntry`; this controls the panel itself.
   */
  display?: LegendDisplayConfig;
  onOpacityChange?: (layerId: string, opacity: number) => void;
  className?: string;
}

/**
 * The single legend opacity slider is a 0–1 MULTIPLIER on each style's
 * configured base opacity (the actual scaling happens in the consumer, e.g.
 * map-client's `setLayerOpacity`). The slider's displayed position is the
 * layer's `_opacityFactor` — a runtime field the consumer stitches onto the
 * layer so display (here) and write (the store) stay consistent across all of
 * a layer's styles, instead of reading only `styles[0]`.
 *
 * When `_opacityFactor` is absent (the slider has never been touched, or the
 * consumer tracks opacity out-of-band) the slider sits at its neutral 100%.
 */
export function getLayerOpacity(layer: LayerConfig): number {
  const factor = (layer as LayerConfig & { _opacityFactor?: number })._opacityFactor;
  return typeof factor === 'number' ? factor : 1;
}

function Swatch({
  color,
  shape,
  outlineColor,
  outlineWidth,
  dasharray,
}: {
  color: string;
  shape?: string;
  outlineColor?: string;
  outlineWidth?: number;
  /**
   * Optional dasharray. Mirrors MapLibre's `line-dasharray`. Applied to
   * `line`, `outline-square`, and `outline-circle` shapes; ignored elsewhere.
   */
  dasharray?: number[];
}) {
  const resolvedShape = shape ?? 'square';
  let inner: React.ReactNode;

  if (resolvedShape === 'circle') {
    inner = (
      <span
        className="mapui:inline-block mapui:h-3.5 mapui:w-3.5 mapui:rounded-full"
        style={{ backgroundColor: color }}
      />
    );
  } else if (resolvedShape === 'line') {
    if (dasharray && dasharray.length > 1) {
      // SVG dasharray faithfully reproduces MapLibre's [dash, gap, dash, gap]
      // pattern so per-category dash styles are legible at-a-glance.
      inner = (
        <svg
          viewBox="0 0 16 4"
          className="mapui:inline-block"
          style={{ width: 16, height: 4 }}
          aria-hidden
        >
          <line
            x1={0}
            y1={2}
            x2={16}
            y2={2}
            stroke={color}
            strokeWidth={2}
            strokeDasharray={dasharray.join(',')}
            strokeLinecap="butt"
          />
        </svg>
      );
    } else {
      inner = (
        <span
          className="mapui:inline-block mapui:h-0.5 mapui:w-4 mapui:rounded-full"
          style={{ backgroundColor: color }}
        />
      );
    }
  } else if (resolvedShape === 'outline-square' || resolvedShape === 'outline-circle') {
    // SVG rather than CSS border: CSS `border-style: dashed` doesn't expose
    // dash/gap control, so the same per-entry `dasharray` field that drives
    // the `line` shape can drive these outlines too. Sharp 90° corners on
    // the square keep it visually distinct from the circle.
    const sw = outlineWidth ?? 1;
    const stroke = outlineColor ?? color;
    const dash = dasharray && dasharray.length > 1 ? dasharray.join(',') : undefined;
    // Inset by half the stroke width so the stroke doesn't get clipped by
    // the viewBox edge.
    const inset = sw / 2;
    const size = 14;
    inner = (
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="mapui:inline-block"
        style={{ width: size, height: size }}
        aria-hidden
      >
        {resolvedShape === 'outline-square' ? (
          <rect
            x={inset}
            y={inset}
            width={size - sw}
            height={size - sw}
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray={dash}
          />
        ) : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={size / 2 - inset}
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray={dash}
          />
        )}
      </svg>
    );
  } else {
    // square (default)
    inner = (
      <span
        className="mapui:inline-block mapui:h-3.5 mapui:w-3.5 mapui:rounded-sm"
        style={{ backgroundColor: color }}
      />
    );
  }

  return (
    <span className="mapui:inline-flex mapui:items-center mapui:justify-center mapui:w-5 mapui:shrink-0">
      {inner}
    </span>
  );
}

/** Builds a CSS gradient string with hard color stops (no blending between colors). */
function segmentedGradient(entries: LegendEntry[]): string {
  return `linear-gradient(to right, ${entries.map((e, i) => `${e.color} ${(i / entries.length) * 100}% ${((i + 1) / entries.length) * 100}%`).join(', ')})`;
}

/** Builds a smooth CSS gradient string. */
function smoothGradient(entries: LegendEntry[]): string {
  return `linear-gradient(to right, ${entries.map((e) => e.color).join(', ')})`;
}

/** Parses a hex color (#rgb or #rrggbb) to its HSL hue (0–360), or null if unparseable. */
function hexToHue(color: string): number | null {
  const hex = color.trim();
  let r: number, g: number, b: number;
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (/^#[0-9a-f]{6}$/i.test(hex)) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  } else {
    return null;
  }
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + 6) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return h * 60;
}

/** Sorts legend entries by hue; entries with non-hex colors are placed at the end. */
function sortByHue(entries: LegendEntry[]): LegendEntry[] {
  return [...entries].sort((a, b) => {
    const ha = hexToHue(a.color);
    const hb = hexToHue(b.color);
    if (ha === null && hb === null) return 0;
    if (ha === null) return 1;
    if (hb === null) return -1;
    return ha - hb;
  });
}

function SimpleLegend({ legend, label, hasArrowColumn, textStyle }: { legend: LegendConfig; label: string; hasArrowColumn?: boolean; textStyle?: CSSProperties }) {
  const { entries } = legend;
  const arrowSpacer = hasArrowColumn ? <span className="mapui:w-5 mapui:shrink-0" /> : null;
  if (entries.length === 1) {
    return (
      <div className="mapui:flex mapui:items-center mapui:gap-2 mapui:min-w-0">
        {arrowSpacer}
        <Swatch color={entries[0].color} shape={entries[0].shape} outlineColor={entries[0].outlineColor} outlineWidth={entries[0].outlineWidth} dasharray={entries[0].dasharray} />
        <span className="mapui:text-slate-700 mapui:truncate" style={textStyle}>
          {entries[0].label || label}
        </span>
      </div>
    );
  }
  return (
    <div>
      <div className="mapui:mb-1 mapui:text-xs mapui:font-medium mapui:text-slate-600" style={textStyle}>
        {label}
      </div>
      <ul className="mapui:m-0 mapui:list-none mapui:space-y-1 mapui:p-0 mapui:pl-1">
        {entries.map((entry, i) => (
          <li
            key={`${entry.label}-${i}`}
            className="mapui:flex mapui:items-center mapui:gap-2 mapui:min-w-0"
          >
            {arrowSpacer}
            <Swatch color={entry.color} shape={entry.shape} outlineColor={entry.outlineColor} outlineWidth={entry.outlineWidth} dasharray={entry.dasharray} />
            <span className="mapui:text-slate-700 mapui:truncate" style={textStyle}>{entry.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoricalLegend({
  legend,
  label,
  expanded,
  onToggle,
  hasArrowColumn,
  textStyle,
}: {
  legend: LegendConfig;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  hasArrowColumn?: boolean;
  textStyle?: CSSProperties;
}) {
  const { entries } = legend;
  const showColorBar = legend.showColorBar !== false;
  const showArrow = legend.showDisclosureArrow !== false;
  const showLabelsCollapsed = legend.showLabelsCollapsed ?? false;
  const uniqueColorEntries = entries.filter((e, i, arr) => arr.findIndex((x) => x.color === e.color) === i);
  const sortedEntries = sortByHue(uniqueColorEntries);

  const arrowElement = (
    <span className="mapui:inline-flex mapui:items-center mapui:justify-center mapui:w-5 mapui:shrink-0">
      <span className="mapui:text-slate-400">
        {expanded ? <MdOutlineKeyboardArrowDown /> : <MdOutlineKeyboardArrowRight />}
      </span>
    </span>
  );

  const header = (
    <>
      {/* Col 1: arrow column — only when hasArrowColumn (two-column layout) */}
      {hasArrowColumn && (showArrow ? arrowElement : <span className="mapui:w-5 mapui:shrink-0" />)}
      {/* Col 2: color indicator — or arrow when it's the sole prefix */}
      {showColorBar ? (
        <div
          className="mapui:h-3 mapui:w-5 mapui:rounded-sm mapui:shrink-0"
          style={{ background: segmentedGradient(sortedEntries) }}
        />
      ) : !hasArrowColumn && showArrow ? (
        arrowElement
      ) : (
        <span className="mapui:w-5 mapui:shrink-0" />
      )}
      <span className="mapui:truncate">{label}</span>
    </>
  );
  return (
    <div>
      {showArrow ? (
        <button
          type="button"
          className="mapui:flex mapui:items-center mapui:gap-2 mapui:bg-transparent mapui:border-none mapui:p-0 mapui:cursor-pointer mapui:text-left mapui:text-slate-700 mapui:text-sm mapui:font-medium mapui:min-w-0"
          style={textStyle}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {header}
        </button>
      ) : (
        <div className="mapui:flex mapui:items-center mapui:gap-2 mapui:text-slate-700 mapui:text-sm mapui:font-medium mapui:min-w-0" style={textStyle}>
          {header}
        </div>
      )}
      {(expanded || showLabelsCollapsed) && (
        <ul className={`mapui:m-0 mapui:mt-1 mapui:list-none mapui:space-y-1 mapui:p-0 mapui:max-h-48 mapui:overflow-y-auto${showArrow ? ' mapui:ml-7' : ''}`}>
          {entries.map((entry, i) => (
            <li
              key={`${entry.label}-${i}`}
              className="mapui:flex mapui:items-center mapui:gap-2 mapui:min-w-0"
            >
              <Swatch color={entry.color} shape={entry.shape} outlineColor={entry.outlineColor} outlineWidth={entry.outlineWidth} dasharray={entry.dasharray} />
              <span className="mapui:text-slate-700 mapui:truncate mapui:text-xs" style={textStyle}>
                {entry.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GradientLegend({
  legend,
  label,
  expanded,
  onToggle,
  hasArrowColumn,
  textStyle,
}: {
  legend: LegendConfig;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  hasArrowColumn?: boolean;
  textStyle?: CSSProperties;
}) {
  const { entries, gradientProperty } = legend;
  const showColorBar = legend.showColorBar !== false;
  const showArrow = legend.showDisclosureArrow !== false;

  const arrowElement = (
    <span className="mapui:inline-flex mapui:items-center mapui:justify-center mapui:w-5 mapui:shrink-0">
      <span className="mapui:text-slate-400">
        {expanded ? <MdOutlineKeyboardArrowDown /> : <MdOutlineKeyboardArrowRight />}
      </span>
    </span>
  );

  const header = (
    <>
      {/* Col 1: arrow column — only when hasArrowColumn */}
      {hasArrowColumn && (showArrow ? arrowElement : <span className="mapui:w-5 mapui:shrink-0" />)}
      {/* Col 2: inline gradient bar (conditional on showColorBar) */}
      {showColorBar ? (
        <div
          className="mapui:h-3 mapui:w-5 mapui:rounded-sm mapui:shrink-0"
          style={{ background: smoothGradient(entries) }}
        />
      ) : !hasArrowColumn && showArrow ? (
        arrowElement
      ) : (
        <span className="mapui:w-5 mapui:shrink-0" />
      )}
      <span className="mapui:truncate">{label}</span>
    </>
  );
  return (
    <div>
      {showArrow ? (
        <button
          type="button"
          className="mapui:flex mapui:items-center mapui:gap-2 mapui:bg-transparent mapui:border-none mapui:p-0 mapui:cursor-pointer mapui:text-left mapui:text-slate-700 mapui:text-sm mapui:font-medium"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {header}
        </button>
      ) : (
        <div className="mapui:flex mapui:items-center mapui:gap-2 mapui:text-slate-700 mapui:text-sm mapui:font-medium" style={textStyle}>
          {header}
        </div>
      )}
      {expanded && (
        <>
        {gradientProperty && (
          <div className={`mapui:mt-1 mapui:text-xs mapui:font-medium mapui:text-slate-600${showArrow ? ' mapui:ml-7' : ''}`} style={textStyle}>
            {gradientProperty}
          </div>
        )}
        <ul className={`mapui:m-0 mapui:mt-1 mapui:list-none mapui:space-y-1 mapui:p-0${showArrow ? ' mapui:ml-7' : ''}`}>
          {entries.map((entry, i) => (
            <li
              key={`${entry.label}-${i}`}
              className="mapui:flex mapui:items-center mapui:gap-2 mapui:min-w-0"
            >
              <Swatch color={entry.color} shape={entry.shape} outlineColor={entry.outlineColor} outlineWidth={entry.outlineWidth} dasharray={entry.dasharray} />
              <span className="mapui:text-slate-700 mapui:truncate mapui:text-xs" style={textStyle}>
                {entry.label}
              </span>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}

function OpacitySlider({
  layerId,
  opacity,
  onChange,
  hasArrowColumn,
}: {
  layerId: string;
  opacity: number;
  onChange: (layerId: string, opacity: number) => void;
  hasArrowColumn?: boolean;
}) {
  return (
    <div className={`mapui:flex mapui:items-center mapui:gap-1.5 mapui:mt-0.5 ${hasArrowColumn ? 'mapui:ml-14' : 'mapui:ml-7'}`}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={opacity}
        onChange={(e) => onChange(layerId, parseFloat(e.target.value))}
        className="range-sm mapui:w-14"
      />
      <span className="mapui:text-[9px] mapui:text-slate-400 mapui:w-6 mapui:text-right mapui:tabular-nums">
        {Math.round(opacity * 100)}%
      </span>
    </div>
  );
}

export function Legend({ layers, visibleLayerIds, legendOrder, display, onOpacityChange, className }: LegendProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const visibleLayers = layers.filter((l) => visibleLayerIds.includes(l.id));

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Only show layers that have an explicit legend config
  const unorderedLegendLayers = visibleLayers.filter((l) => l.legend !== undefined);

  // Apply explicit legendOrder (when provided): listed IDs first in order,
  // then any remaining layers in their natural order. Unknown IDs are ignored.
  const legendLayers = (() => {
    if (!legendOrder || legendOrder.length === 0) return unorderedLegendLayers;
    const byId = new Map(unorderedLegendLayers.map((l) => [l.id, l]));
    const ordered: typeof unorderedLegendLayers = [];
    const seen = new Set<string>();
    for (const id of legendOrder) {
      const match = byId.get(id);
      if (match && !seen.has(id)) {
        ordered.push(match);
        seen.add(id);
      }
    }
    for (const l of unorderedLegendLayers) {
      if (!seen.has(l.id)) ordered.push(l);
    }
    return ordered;
  })();

  if (legendLayers.length === 0) {
    return null;
  }

  // True when any legend row needs BOTH an arrow column AND a color indicator column.
  // This triggers the two-column prefix layout for ALL rows so labels align.
  const hasArrowColumn = legendLayers.some((l) => {
    const legend = l.legend!;
    const mode = legend.displayMode ?? 'simple';
    const hasArrow = legend.showDisclosureArrow !== false;
    if (mode === 'gradient') return hasArrow && legend.showColorBar !== false;
    if (mode === 'categorical') return hasArrow && legend.showColorBar !== false;
    return false;
  });

  // Inline style overrides for the panel chrome. When `display.background` is
  // omitted the bg-white class still applies; when set it overrides.
  const panelStyle: CSSProperties = {};
  if (display?.background) panelStyle.backgroundColor = display.background;
  if (display?.borderColor) {
    panelStyle.border = `1px solid ${display.borderColor}`;
  }
  if (display?.textColor) panelStyle.color = display.textColor;
  // Inline text-color override applied to every text-bearing element so it
  // beats the Tailwind `mapui:text-slate-*` classes that win over a parent
  // inline `color`.
  const textStyle: CSSProperties | undefined = display?.textColor
    ? { color: display.textColor }
    : undefined;

  return (
    <div
      className={`mapui:rounded-lg mapui:bg-white mapui:p-3 mapui:shadow-md mapui:text-sm${className ? ` ${className}` : ''}`}
      style={panelStyle}
    >
      <div className="mapui:flex mapui:items-center mapui:justify-between mapui:mb-2">
        <h3 className="mapui:m-0 mapui:text-xs mapui:font-semibold mapui:uppercase mapui:tracking-wide mapui:text-slate-500" style={display?.textColor ? { color: display.textColor } : undefined}>
          Legend
        </h3>
        {onOpacityChange && (
          <button
            type="button"
            className="mapui:bg-transparent mapui:border-none mapui:p-0 mapui:cursor-pointer mapui:text-slate-400 hover:mapui:text-slate-600 mapui:text-sm"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse legend' : 'Expand legend'}
          >
            {expanded ? <LuMinimize2 /> : <LuMaximize2 />}
          </button>
        )}
      </div>
      <ul className={`mapui:m-0 mapui:list-none mapui:p-0 ${expanded ? 'mapui:space-y-1.5' : 'mapui:space-y-2'}`}>
        {legendLayers.map((layer) => {
          const legend = layer.legend!;
          const mode = legend.displayMode ?? 'simple';
          const isEntryExpanded = expanded || expandedIds.has(layer.id);

          return (
            <li key={layer.id}>
              {mode === 'categorical' ? (
                <CategoricalLegend
                  legend={legend}
                  label={layer.label}
                  expanded={isEntryExpanded}
                  onToggle={() => toggleExpand(layer.id)}
                  hasArrowColumn={hasArrowColumn}
                  textStyle={textStyle}
                />
              ) : mode === 'gradient' ? (
                <GradientLegend
                  legend={legend}
                  label={layer.label}
                  expanded={isEntryExpanded}
                  onToggle={() => toggleExpand(layer.id)}
                  hasArrowColumn={hasArrowColumn}
                  textStyle={textStyle}
                />
              ) : (
                <SimpleLegend legend={legend} label={layer.label} hasArrowColumn={hasArrowColumn} textStyle={textStyle} />
              )}
              {expanded && onOpacityChange && (
                <OpacitySlider
                  layerId={layer.id}
                  opacity={getLayerOpacity(layer)}
                  onChange={onOpacityChange}
                  hasArrowColumn={hasArrowColumn}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
