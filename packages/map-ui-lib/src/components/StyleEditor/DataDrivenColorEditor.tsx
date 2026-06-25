import type { AvailableProperty, FetchDistinctValuesFn } from '../../types';
import { ColorPicker } from '../admin/ColorPicker';
import { getColorFromPalette } from '../../utils/colorPalettes';
import { COLOR_THEMES, COLOR_THEME_IDS, type ColorThemeId } from '../../utils/colorThemes';
import { DataDrivenExpressionEditor } from './DataDrivenExpressionEditor';

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

const inputClass =
  'mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500';

export function DataDrivenColorEditor({
  value,
  onChange,
  availableProperties = [],
  onFetchDistinctValues,
  theme,
  onThemeChange,
}: DataDrivenColorEditorProps) {
  const themePanel = onThemeChange ? (
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
  ) : undefined;

  return (
    <DataDrivenExpressionEditor<string>
      value={value}
      onChange={onChange}
      availableProperties={availableProperties}
      supportedModes={['match', 'interpolate']}
      parseOutput={(raw) => (typeof raw === 'string' ? raw : '#000000')}
      serializeOutput={(v) => v}
      defaultOutput={(rowIndex) => getColorFromPalette(rowIndex, theme)}
      renderOutputCell={({ value: color, onChange: setColor, rowIndex, context }) => (
        <ColorPicker
          value={color}
          onChange={setColor}
          label={
            context === 'fallback'
              ? 'Fallback color'
              : context === 'stop'
              ? `Color at stop ${rowIndex}`
              : `Pair color ${rowIndex}`
          }
        />
      )}
      sidePanel={themePanel}
      onFetchDistinctValues={onFetchDistinctValues}
      autoPopulateOutputs={(values) => values.map((_, i) => getColorFromPalette(i, theme))}
      // Lets the user hide features matching no category (fully transparent fill).
      fallbackHiddenValue="rgba(0,0,0,0)"
    />
  );
}
