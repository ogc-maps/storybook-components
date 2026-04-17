import { useEffect, useMemo } from 'react';
import type { LayerConfig, SearchFilterValues, SearchFilterValue, SearchField, NumberSearchField, DatetimeSearchField, TextSearchField, SelectSearchField, CategorySearchField, AvailableProperty } from '../../types';
import type { PropertyFilter } from '../../utils/propertyFilters';
import { AutocompleteInput } from './AutocompleteInput';
import { DateRangeInput } from './DateRangeInput';
import { NumberInput } from './NumberInput';
import { PropertyFilterPanel } from '../PropertyFilterPanel';

export interface SearchPanelProps {
  layers: LayerConfig[];
  activeFilters: Record<string, SearchFilterValues>;
  onFilterChange: (layerId: string, property: string, value: SearchFilterValue) => void;
  onClearFilters: (layerId: string) => void;
  autocompleteSuggestions?: Record<string, string[]>;
  onFetchSuggestions?: (layerId: string, property: string, query: string, options?: { prefetch?: boolean }) => void;
  onZoomToFeature?: (layerId: string, property: string, value: string) => void;
  className?: string;
  hideTitle?: boolean;
  /** When true, shows an expand button that toggles a centered modal view with the All Filters builder. */
  expandable?: boolean;
  /** Controlled expanded state. Only honored when `expandable` is true. */
  expanded?: boolean;
  /** Callback when the user toggles the expand button. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Per-layer queryable properties, keyed by layer id. Enables typed property pickers in the All Filters builder. */
  availableProperties?: Record<string, AvailableProperty[]>;
  /** Flat ad-hoc property filter list rendered in the expanded "All Filters" view. Controlled. */
  propertyFilters?: PropertyFilter[];
  /** Callback when the user edits the flat property filter list. */
  onPropertyFiltersChange?: (filters: PropertyFilter[]) => void;
}

function isFilterActive(value: SearchFilterValue): boolean {
  if (value === undefined || value === '' || value === null) return false;
  if (typeof value === 'object') {
    if ('start' in value && 'end' in value) {
      return (value as { start: string; end: string }).start !== '' ||
        (value as { start: string; end: string }).end !== '';
    }
    return true;
  }
  return true;
}

export function SearchPanel({
  layers,
  activeFilters,
  onFilterChange,
  onClearFilters,
  autocompleteSuggestions = {},
  onZoomToFeature,
  onFetchSuggestions,
  className = '',
  hideTitle,
  expandable = false,
  expanded = false,
  onExpandedChange,
  availableProperties,
  propertyFilters,
  onPropertyFiltersChange,
}: SearchPanelProps) {
  const searchableLayers = useMemo(
    () => layers.filter((layer) => layer.search?.fields.length),
    [layers]
  );

  useEffect(() => {
    if (!onFetchSuggestions) return;
    for (const layer of searchableLayers) {
      for (const field of layer.search!.fields) {
        if (field.type === 'select' && (field as SelectSearchField).prefetch) {
          onFetchSuggestions(layer.id, field.property, '', { prefetch: true });
        }
      }
    }
  }, [searchableLayers, onFetchSuggestions]);

  const showExpandButton = expandable && !expanded;
  const showCollapseButton = expandable && expanded;
  const showPropertyFilters = expanded && propertyFilters !== undefined && onPropertyFiltersChange !== undefined;

  const titleNode = !hideTitle || showCollapseButton ? (
    <div className="mapui:flex mapui:items-center mapui:justify-between mapui:mb-2">
      {!hideTitle ? (
        <h3 className="mapui:m-0 mapui:text-sm mapui:font-semibold mapui:text-slate-700">
          Search &amp; Filter
        </h3>
      ) : <span />}
      {showCollapseButton && (
        <button
          type="button"
          onClick={() => onExpandedChange?.(false)}
          title="Close"
          className="mapui:cursor-pointer mapui:rounded mapui:border-none mapui:bg-transparent mapui:p-2 mapui:min-w-[44px] mapui:min-h-[44px] mapui:flex mapui:items-center mapui:justify-center mapui:text-slate-500 hover:mapui:text-slate-800"
          aria-label="Close expanded search"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mapui:h-4 mapui:w-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </div>
  ) : null;

  const expandFooter = showExpandButton ? (
    <button
      type="button"
      onClick={() => onExpandedChange?.(true)}
      title="Expand to full search builder"
      aria-label="Expand to full search builder"
      className="mapui:mt-1 mapui:w-full mapui:cursor-pointer mapui:border-0 mapui:border-t mapui:border-solid mapui:border-slate-200 mapui:bg-transparent mapui:pt-2 mapui:text-center mapui:text-xs mapui:text-slate-600 hover:mapui:text-blue-600"
    >
      Expand
    </button>
  ) : null;

  if (searchableLayers.length === 0) {
    const body = (
      <div className={`mapui:flex mapui:flex-col mapui:gap-1 ${className}`.trim()}>
        {titleNode}
        <p className="mapui:m-0 mapui:text-xs mapui:text-slate-500">
          No searchable layers configured.
        </p>
        {expandFooter}
      </div>
    );
    return expanded ? <ModalShell onClose={() => onExpandedChange?.(false)}>{body}</ModalShell> : body;
  }

  const panelBody = (
    <div className={`mapui:flex mapui:flex-col mapui:gap-3 ${expanded ? '' : className}`.trim()}>
      {titleNode}

      {searchableLayers.map((layer) => {
        const layerFilters = activeFilters[layer.id] ?? {};
        const hasActiveFilters = Object.values(layerFilters).some(isFilterActive);

        return (
          <div key={layer.id} className="mapui:flex mapui:flex-col mapui:gap-3 mapui:border-b mapui:border-slate-100 mapui:pb-3 last:mapui:border-0">
            <div className="mapui:flex mapui:items-center mapui:justify-between">
              <span className="mapui:text-sm mapui:font-medium mapui:text-slate-600">
                {layer.label}
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => onClearFilters(layer.id)}
                  className="mapui:cursor-pointer mapui:border-none mapui:bg-transparent mapui:p-0 mapui:text-xs mapui:text-blue-600 hover:mapui:text-blue-800"
                >
                  Clear
                </button>
              )}
            </div>
            {layer.search!.fields.map((field: SearchField) => {
              const value = layerFilters[field.property];
              const suggestionKey = `${layer.id}:${field.property}`;
              const fieldId = `search-${layer.id}-${field.property}`;

              return (
                <div key={field.property} className="mapui:flex mapui:flex-col mapui:gap-1">
                  <label htmlFor={fieldId} className="mapui:text-xs mapui:text-slate-500">{field.label}</label>

                  {field.type === 'text' && (field as TextSearchField).autocomplete ? (
                    <AutocompleteInput
                      id={fieldId}
                      value={(value as string) ?? ''}
                      onChange={(v) => {
                        onFilterChange(layer.id, field.property, v || undefined);
                        if (v && (field as TextSearchField).zoomTo) {
                          onZoomToFeature?.(layer.id, field.property, v);
                        }
                      }}
                      suggestions={[...new Set([
                        ...(autocompleteSuggestions[suggestionKey] ?? []),
                        ...((field as TextSearchField).options ?? []),
                      ])]}
                      onQueryChange={(q) => onFetchSuggestions?.(layer.id, field.property, q, { prefetch: (field as TextSearchField).prefetch })}
                      placeholder={(field as TextSearchField).placeholder ?? ''}
                    />
                  ) : field.type === 'text' ? (
                    <input
                      id={fieldId}
                      type="text"
                      value={(value as string) ?? ''}
                      placeholder={(field as TextSearchField).placeholder ?? ''}
                      onChange={(e) =>
                        onFilterChange(layer.id, field.property, e.target.value || undefined)
                      }
                      onBlur={(e) => {
                        if (e.target.value && (field as TextSearchField).zoomTo) {
                          onZoomToFeature?.(layer.id, field.property, e.target.value);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.target as HTMLInputElement).value && (field as TextSearchField).zoomTo) {
                          onZoomToFeature?.(layer.id, field.property, (e.target as HTMLInputElement).value);
                        }
                      }}
                      className="mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
                    />
                  ) : field.type === 'datetime' && (field as DatetimeSearchField).range ? (
                    <DateRangeInput
                      id={fieldId}
                      startValue={
                        value && typeof value === 'object' && 'start' in value
                          ? (value as { start: string; end: string }).start
                          : ''
                      }
                      endValue={
                        value && typeof value === 'object' && 'end' in value
                          ? (value as { start: string; end: string }).end
                          : ''
                      }
                      onStartChange={(start) =>
                        onFilterChange(layer.id, field.property, {
                          start,
                          end:
                            value && typeof value === 'object' && 'end' in value
                              ? (value as { start: string; end: string }).end
                              : '',
                        })
                      }
                      onEndChange={(end) =>
                        onFilterChange(layer.id, field.property, {
                          start:
                            value && typeof value === 'object' && 'start' in value
                              ? (value as { start: string; end: string }).start
                              : '',
                          end,
                        })
                      }
                    />
                  ) : field.type === 'datetime' ? (
                    <input
                      id={fieldId}
                      type="datetime-local"
                      value={(value as string) ?? ''}
                      onChange={(e) =>
                        onFilterChange(layer.id, field.property, e.target.value || undefined)
                      }
                      className="mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
                    />
                  ) : field.type === 'number' ? (
                    <NumberInput
                      id={fieldId}
                      field={field as NumberSearchField}
                      value={value}
                      onChange={(v) => onFilterChange(layer.id, field.property, v)}
                    />
                  ) : field.type === 'select' ? (() => {
                    const selectField = field as SelectSearchField;
                    const dynamicOptions = autocompleteSuggestions[suggestionKey] ?? [];
                    const staticOptions = selectField.options ?? [];
                    const allOptions = [...new Set([...dynamicOptions, ...staticOptions])];
                    return (
                      <select
                        id={fieldId}
                        value={(value as string) ?? ''}
                        onChange={(e) => {
                          const newValue = e.target.value || undefined;
                          onFilterChange(layer.id, field.property, newValue);
                          if (newValue && (field as SelectSearchField).zoomTo) {
                            onZoomToFeature?.(layer.id, field.property, newValue);
                          }
                        }}
                        className="mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
                      >
                        <option value="">{field.placeholder ?? 'Select...'}</option>
                        {allOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    );
                  })() : field.type === 'category' ? (() => {
                    const catField = field as CategorySearchField;
                    return (
                      <select
                        id={fieldId}
                        value={(value as string) ?? ''}
                        onChange={(e) => {
                          const newValue = e.target.value || undefined;
                          onFilterChange(layer.id, field.property, newValue);
                        }}
                        className="mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500"
                      >
                        <option value="">{field.placeholder ?? 'Select a group…'}</option>
                        {catField.categoryGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.label}
                          </option>
                        ))}
                      </select>
                    );
                  })() : null}
                </div>
              );
            })}
          </div>
        );
      })}

      {showPropertyFilters && (
        <div className="mapui:mt-2 mapui:border-t mapui:border-slate-200 mapui:pt-3">
          <PropertyFilterPanel
            layers={layers}
            availableProperties={availableProperties}
            filters={propertyFilters!}
            onFiltersChange={onPropertyFiltersChange!}
          />
        </div>
      )}

      {expandFooter}
    </div>
  );

  if (expanded) {
    return <ModalShell onClose={() => onExpandedChange?.(false)}>{panelBody}</ModalShell>;
  }
  return panelBody;
}

function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="mapui:fixed mapui:inset-0 mapui:z-50 mapui:flex mapui:items-center mapui:justify-center mapui:bg-black/40 mapui:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mapui:relative mapui:flex mapui:max-h-[90vh] mapui:w-full mapui:max-w-2xl mapui:flex-col mapui:overflow-y-auto mapui:rounded-lg mapui:bg-white mapui:p-4 mapui:shadow-xl">
        {children}
      </div>
    </div>
  );
}
