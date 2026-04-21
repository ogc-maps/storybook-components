import { useState, useEffect, useRef } from 'react';
import type { LayerConfig, OgcApiSource, AvailableProperty, StyleConfig, Cql2FilterConfig } from '../../types';
import { slugify } from '../../utils/slugify';
import { FormField } from '../admin/FormField';
import { CollapsibleSection } from '../admin/CollapsibleSection';
import { defaultFill, defaultCircle } from '../StyleEditor/StyleEditor';
import { StyleCard } from '../StyleEditor/StyleCard';
import { LegendEditor } from '../LegendEditor/LegendEditor';
import { SearchFieldList } from '../SearchFieldEditor/SearchFieldList';
import { PropertyDisplayEditor } from '../PropertyDisplayEditor/PropertyDisplayEditor';
import { Cql2FilterEditor } from '../Cql2FilterEditor/Cql2FilterEditor';

import { useOgcCollections } from '../../hooks/useOgcCollections';
import { useOgcQueryables } from '../../hooks/useOgcQueryables';
import { fetchFeatures, fetchDistinctValues } from '../../utils/ogcApi';
import {
  detectGeometryStyleTypesFromQueryables,
  detectGeometryTypesFromFeatures,
  buildDefaultStylesForGeometryTypes,
  geometryTypeToStyleTypes,
  toAvailableProperties,
  getGeometryPropertyNames,
} from '../../utils/queryableHelpers';

function replaceAt<T>(arr: T[] | undefined, index: number, value: T): T[] {
  const next = [...(arr ?? [])];
  next[index] = value;
  return next;
}

function removeAt<T>(arr: T[] | undefined, index: number): T[] {
  return (arr ?? []).filter((_, i) => i !== index);
}

export type LayerEditorSection = 'style' | 'legend' | 'search' | 'propertyDisplay' | 'cql2Filter';

export interface LayerEditorProps {
  value: LayerConfig;
  onChange: (layer: LayerConfig) => void;
  availableSources: OgcApiSource[];
  availableIcons?: string[];
  /** Which collapsible sections to show. If omitted, all sections render. */
  sections?: LayerEditorSection[];
  /** Whether to show basic config fields (ID, source, collection, etc.). Default true. */
  showBasicFields?: boolean;
}

const inputClass =
  'mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500';

export function LayerEditor({ value, onChange, availableSources, availableIcons, sections, showBasicFields = true }: LayerEditorProps) {
  const showSection = (s: LayerEditorSection) => !sections || sections.includes(s);

  // useRef (not state) so flipping it doesn't trigger a re-render
  const idManuallySet = useRef(value.id.length > 0);
  const [editingId, setEditingId] = useState(false);

  const update = (patch: Partial<LayerConfig>) => {
    const next = { ...value, ...patch };
    if (!idManuallySet.current) {
      if (patch.label !== undefined) {
        next.id = slugify(next.label) || slugify(next.collection);
      } else if (patch.collection !== undefined && !next.label) {
        next.id = slugify(next.collection);
      }
    }
    onChange(next);
  };

  // Refs to always have latest value/onChange in async callbacks (avoid stale closures)
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Resolve baseUrl from the selected source
  const source = availableSources.find((s) => s.id === value.sourceId);
  const baseUrl = source?.url ?? null;
  const collection = value.collection || null;

  // Fetch collections for the dropdown
  const { collections, loading: collectionsLoading } = useOgcCollections(baseUrl);

  // Fetch queryables when a collection is selected
  const { queryables, loading: queryablesLoading } = useOgcQueryables(baseUrl, collection);

  // Derive available non-geometry properties
  const availableProperties: AvailableProperty[] = queryables
    ? toAvailableProperties(queryables)
    : [];

  // Derive geometry property names for spatial constraint UI
  const geometryProperties = queryables ? getGeometryPropertyNames(queryables) : [];

  // Detect suggested styles from queryables; fall back to fetching features
  const [suggestedStyles, setSuggestedStyles] = useState<StyleConfig[]>([]);
  // All suitable style types for the detected geometry (e.g. ['circle', 'symbol'] for Point)
  const [suitableStyleTypes, setSuitableStyleTypes] = useState<StyleConfig['type'][]>([]);

  useEffect(() => {
    if (!queryables) {
      setSuggestedStyles([]);
      setSuitableStyleTypes([]);
      return;
    }

    const applyGeomTypes = (geomTypes: string[], styleTypes: StyleConfig['type'][]) => {
      const styles = buildDefaultStylesForGeometryTypes(geomTypes);
      setSuggestedStyles(styles);
      setSuitableStyleTypes(styleTypes);
      if (styles.length > 0 && !valueRef.current.styles?.length) {
        onChangeRef.current({ ...valueRef.current, styles });
      }
    };

    const fromQueryables = detectGeometryStyleTypesFromQueryables(queryables);
    if (fromQueryables.length > 0) {
      // Map style type names back to geometry type families for buildDefaultStylesForGeometryTypes
      const geomTypes: string[] = [];
      for (const st of fromQueryables) {
        if (st === 'fill') geomTypes.push('Polygon');
        else if (st === 'line') geomTypes.push('LineString');
        else if (st === 'circle' || st === 'symbol') geomTypes.push('Point');
      }
      applyGeomTypes(geomTypes, fromQueryables);
      return;
    }

    // Fallback: inspect geometry types from fetched features
    if (!baseUrl || !collection) {
      setSuggestedStyles([]);
      setSuitableStyleTypes([]);
      return;
    }

    let cancelled = false;
    fetchFeatures(baseUrl, collection, { limit: 20 })
      .then((fc) => {
        if (cancelled) return;
        const geomTypes = detectGeometryTypesFromFeatures(fc.features);
        if (geomTypes.length > 0) {
          const allTypes = new Set<StyleConfig['type']>();
          for (const gt of geomTypes) {
            for (const st of geometryTypeToStyleTypes(gt)) allTypes.add(st);
          }
          applyGeomTypes(geomTypes, Array.from(allTypes));
        } else {
          setSuggestedStyles([]);
          setSuitableStyleTypes([]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestedStyles([]);
          setSuitableStyleTypes([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [queryables, baseUrl, collection]);

  // Reset suggested styles when source/collection changes
  useEffect(() => {
    setSuggestedStyles([]);
    setSuitableStyleTypes([]);
  }, [baseUrl, collection]);

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-3">
      {showBasicFields && (
        <>
          <FormField label="Source" required>
            <select
              value={value.sourceId}
              onChange={(e) => update({ sourceId: e.target.value })}
              className={inputClass}
            >
              <option value="">Select a source…</option>
              {availableSources.map((src) => (
                <option key={src.id} value={src.id}>
                  {src.label ?? src.id}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Collection" required>
            {collections.length > 0 ? (
              <select
                value={value.collection}
                onChange={(e) => update({ collection: e.target.value })}
                className={inputClass}
              >
                <option value="">Select a collection…</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title ?? c.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={value.collection}
                onChange={(e) => update({ collection: e.target.value })}
                placeholder={collectionsLoading ? 'Loading collections…' : 'collection-id'}
                className={inputClass}
              />
            )}
            {queryablesLoading && (
              <span className="mapui:mt-0.5 mapui:block mapui:text-xs mapui:text-slate-400">
                Loading properties…
              </span>
            )}
          </FormField>

          <FormField label="Label">
            <input
              type="text"
              value={value.label}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="My Layer"
              className={inputClass}
            />
          </FormField>

          <FormField label="Data Mode">
            <div className="mapui:flex mapui:gap-4">
              {(['vector-tiles', 'geojson'] as const).map((mode) => (
                <label key={mode} className="mapui:flex mapui:cursor-pointer mapui:items-center mapui:gap-1.5">
                  <input
                    type="radio"
                    name={`data-mode-${value.id}`}
                    value={mode}
                    checked={value.dataMode === mode}
                    onChange={() => update({ dataMode: mode })}
                    className="mapui:accent-blue-600"
                  />
                  <span className="mapui:text-sm mapui:text-slate-700">{mode}</span>
                </label>
              ))}
            </div>
          </FormField>

          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <input
              type="checkbox"
              id="layer-visible"
              checked={value.visible}
              onChange={(e) => update({ visible: e.target.checked })}
              className="mapui:h-4 mapui:w-4 mapui:accent-blue-600"
            />
            <label htmlFor="layer-visible" className="mapui:text-sm mapui:text-slate-700">
              Visible by default
            </label>
          </div>

          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <input
              type="checkbox"
              id={`layer-tooltip-${value.id}`}
              checked={value.showTooltip ?? true}
              onChange={(e) => update({ showTooltip: e.target.checked })}
              className="mapui:h-4 mapui:w-4 mapui:accent-blue-600"
            />
            <label htmlFor={`layer-tooltip-${value.id}`} className="mapui:text-sm mapui:text-slate-700">
              Show tooltip on hover
            </label>
          </div>

          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <input
              type="checkbox"
              id={`layer-detail-${value.id}`}
              checked={value.showDetailPanel ?? true}
              onChange={(e) => update({ showDetailPanel: e.target.checked })}
              className="mapui:h-4 mapui:w-4 mapui:accent-blue-600"
            />
            <label htmlFor={`layer-detail-${value.id}`} className="mapui:text-sm mapui:text-slate-700">
              Show detail panel on click
            </label>
          </div>

          <div className="mapui:grid mapui:grid-cols-2 mapui:gap-3">
            <FormField label="Min Zoom">
              <input
                type="number"
                min={0}
                max={24}
                step={1}
                value={value.minZoom ?? ''}
                onChange={(e) => { const v = e.target.valueAsNumber; update({ minZoom: isNaN(v) ? undefined : v }); }}
                placeholder="0"
                className={inputClass}
              />
            </FormField>
            <FormField label="Max Zoom">
              <input
                type="number"
                min={0}
                max={24}
                step={1}
                value={value.maxZoom ?? ''}
                onChange={(e) => { const v = e.target.valueAsNumber; update({ maxZoom: isNaN(v) ? undefined : v }); }}
                placeholder="24"
                className={inputClass}
              />
            </FormField>
          </div>

          {editingId ? (
            <FormField label="Layer ID" required>
              <input
                type="text"
                value={value.id}
                onChange={(e) => {
                  idManuallySet.current = true;
                  update({ id: e.target.value });
                }}
                placeholder="my-layer"
                className={inputClass}
                autoFocus
                onBlur={() => { if (valueRef.current.id) setEditingId(false); }}
              />
            </FormField>
          ) : (
            <div className="mapui:flex mapui:items-center mapui:gap-2">
              <span className="mapui:text-xs mapui:text-slate-400">
                ID: <span className="mapui:font-mono mapui:text-slate-600">{value.id || '—'}</span>
              </span>
              <button
                type="button"
                onClick={() => setEditingId(true)}
                className="mapui:cursor-pointer mapui:rounded mapui:border mapui:border-slate-200 mapui:bg-white mapui:px-1.5 mapui:py-0.5 mapui:text-[10px] mapui:text-slate-500 hover:mapui:bg-slate-50"
              >
                Edit ID
              </button>
            </div>
          )}
        </>
      )}

      {showSection('style') && (
        <>
          <div className="mapui:flex mapui:items-center mapui:gap-2 mapui:pt-1">
            <span className="mapui:text-xs mapui:font-semibold mapui:uppercase mapui:tracking-wide mapui:text-slate-500">
              Styles
            </span>
            <div className="mapui:flex-1 mapui:border-t mapui:border-slate-200" />
          </div>
          <div className="mapui:flex mapui:flex-col mapui:gap-2">
            {(value.styles ?? [defaultFill]).map((style, i) => (
              <StyleCard
                key={i}
                style={style}
                index={i}
                onChange={(s) => update({ styles: replaceAt(value.styles, i, s) })}
                onRemove={
                  (value.styles?.length ?? 0) > 1
                    ? () => update({ styles: removeAt(value.styles, i) })
                    : undefined
                }
                defaultOpen={i === 0}
                suggestedTypes={suitableStyleTypes}
                availableIcons={availableIcons}
                availableProperties={availableProperties}
                onFetchDistinctValues={
                  baseUrl && collection
                    ? (property, opts) => fetchDistinctValues(baseUrl, collection, property, { fetchAll: true, ...opts })
                    : undefined
                }
              />
            ))}
            <button
              type="button"
              onClick={() => update({ styles: [...(value.styles ?? [defaultFill]), defaultCircle] })}
              className="mapui:cursor-pointer mapui:self-start mapui:rounded mapui:border mapui:border-slate-300 mapui:bg-white mapui:px-2 mapui:py-1 mapui:text-xs mapui:text-slate-700 hover:mapui:bg-slate-50"
            >
              + Add style
            </button>
          </div>
        </>
      )}

      {showSection('legend') && (
        <CollapsibleSection title="Legend">
          <LegendEditor
            value={value.legend}
            onChange={(legend) => update({ legend })}
            styles={value.styles}
            layerLabel={value.label}
          />
        </CollapsibleSection>
      )}

      {showSection('search') && (
        <CollapsibleSection title="Search Fields">
          <SearchFieldList
            fields={value.search?.fields ?? []}
            onChange={(fields) =>
              update({ search: fields.length > 0 ? { fields } : undefined })
            }
            availableProperties={availableProperties}
          />
        </CollapsibleSection>
      )}

      {showSection('propertyDisplay') && (
        <CollapsibleSection title="Property Display">
          <PropertyDisplayEditor
            value={value.propertyDisplay ?? {}}
            onChange={(propertyDisplay) =>
              update({ propertyDisplay: Object.keys(propertyDisplay).length > 0 ? propertyDisplay : undefined })
            }
            availableProperties={availableProperties}
          />
        </CollapsibleSection>
      )}

      {showSection('cql2Filter') && (
        <CollapsibleSection title="CQL2 Filter" badge={value.cql2Filter?.rules.length ?? 0}>
          <Cql2FilterEditor
            value={value.cql2Filter as Cql2FilterConfig | undefined}
            onChange={(cql2Filter) => update({ cql2Filter } as Partial<LayerConfig>)}
            availableProperties={availableProperties}
            geometryProperties={geometryProperties}
          />
        </CollapsibleSection>
      )}

    </div>
  );
}
