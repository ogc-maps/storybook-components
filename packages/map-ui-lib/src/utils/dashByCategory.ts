/**
 * Helpers for expanding a `dashByCategory` line style into multiple MapLibre
 * `<Layer>` configs, one per case (+ a default-case layer).
 *
 * **Why this exists.** MapLibre style spec data-constants `line-dasharray`
 * (i.e. `["match", ["get", prop], ...]` is rejected at runtime), so the only
 * way to drive dasharray by a feature property is to render multiple layers
 * with mutually exclusive `filter` expressions, each with its own static
 * dasharray. This helper produces those configs so the per-app render code
 * can stay declarative.
 *
 * Stable derived ids: `${baseSourceKey}--${styleIndex}--dash--${valueSlug}`
 * for case layers; `${baseSourceKey}--${styleIndex}--dash--default` for the
 * default-case layer. Stable ids matter because MapLibre identifies layers
 * by id when reordering — see `MapContainer`/`MapPreview` reorder effects.
 */

import type { LineStyle, DashByCategory } from '../types';

/**
 * Paint properties a `dashByCategory` expansion owns per-case (each sub-layer
 * gets its own static value). Renderers strip these from the shared paint, and
 * paint-sync must not overwrite them — both read this list so the rule lives in
 * one place.
 */
export const DASH_PER_CASE_PAINT_PROPS: readonly string[] = ['line-dasharray'];

export interface ExpandedDashSubLayer {
  /** Sub-layer id suffix (caller prepends `${baseSourceKey}--${styleIndex}--`). */
  idSuffix: string;
  /** Static dasharray to apply. */
  dasharray: number[];
  /** MapLibre filter expression restricting features to this case (or the negation, for default). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter: any;
  /** Human-readable label for legend / debugging. Empty string for the default-case sub-layer. */
  label: string;
  /** The case value (or null for the default sub-layer). */
  value: string | number | null;
}

/**
 * Slugify a case value for use in a stable layer id. Non-alphanumeric
 * characters become `_`; case is preserved so `"NO"` and `"no"` produce
 * different ids — important when both appear as cases.
 */
export function slugifyDashCaseValue(v: string | number): string {
  return String(v).replace(/[^A-Za-z0-9]+/g, '_');
}

/**
 * Build the per-case + default-case sub-layer descriptors for a line style
 * with `dashByCategory`. Returns an empty array when the style has no
 * `dashByCategory` (callers should fall back to rendering a single layer
 * with the original paint).
 */
export function expandDashByCategory(style: LineStyle): ExpandedDashSubLayer[] {
  const cfg: DashByCategory | undefined = style.dashByCategory;
  if (!cfg || !cfg.cases.length) return [];

  const out: ExpandedDashSubLayer[] = cfg.cases.map((c) => ({
    idSuffix: `dash--${slugifyDashCaseValue(c.value)}`,
    dasharray: c.dasharray,
    filter: ['==', ['get', cfg.property], c.value],
    label: String(c.value),
    value: c.value,
  }));

  // Default-case layer: features whose property doesn't match any case.
  // Only add when a default dasharray is provided — without one, default
  // features would have no rendering.
  //
  // The default filter intentionally catches features whose property is
  // **missing or null** in addition to "set, but not one of the cases".
  // MapLibre's `!=` against null/missing evaluates to `false`, so a naive
  // `['all', ['!=', prop, v1], ['!=', prop, v2], …]` would leave null/missing
  // features matching neither the case layers (each `==` is false) nor the
  // default layer (each `!=` is also false), and they'd silently disappear.
  // Hence the explicit `!has` + `== null` branches in the `any` head.
  if (cfg.default) {
    const caseValues = cfg.cases.map((c) => c.value);
    const negatedFilter = [
      'any',
      ['!', ['has', cfg.property]],
      ['==', ['get', cfg.property], null],
      ['all', ...caseValues.map((v) => ['!=', ['get', cfg.property], v])],
    ];
    out.push({
      idSuffix: 'dash--default',
      dasharray: cfg.default,
      filter: negatedFilter,
      label: '',
      value: null,
    });
  }

  return out;
}
