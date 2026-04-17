/**
 * CQL2 JSON (OGC Common Query Language 2) types and builder utilities.
 *
 * CQL2 JSON spec: https://docs.ogc.org/is/21-065r2/21-065r2.html
 *
 * All builder functions return plain CQL2Expression objects suitable for
 * JSON serialization and direct use with OGC API endpoints via the
 * `filter` query parameter with `filter-lang=cql2-json`.
 */

import turfBuffer from '@turf/buffer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A reference to a feature property (column) in a CQL2 expression. */
export type CQL2PropertyRef = { property: string };

/** A date literal: ISO 8601 date string "YYYY-MM-DD". */
export type CQL2Date = { date: string };

/** A timestamp literal: ISO 8601 datetime string "YYYY-MM-DDTHH:MM:SSZ". */
export type CQL2Timestamp = { timestamp: string };

/** A temporal interval with start and end as date/timestamp strings or "..". */
export type CQL2Interval = { interval: [string, string] };

/** CQL2 operators that appear in serialized expression nodes. */
export type CQL2Operator =
  | '=' | '<>' | '>' | '>=' | '<' | '<='
  | 'like' | 'in' | 'isNull'
  | 'and' | 'or' | 'not'
  | 't_after' | 't_before' | 't_during'
  | 's_intersects' | 's_within';

/**
 * A CQL2 expression node. The `op` field is constrained to operators
 * that actually appear in serialized CQL2 JSON. UI-level operators like
 * 'between' and 's_dwithin' decompose into simpler expressions before
 * reaching this type.
 */
export type CQL2Expression = {
  op: CQL2Operator;
  args: unknown[];
};

// ---------------------------------------------------------------------------
// Comparison builders
// ---------------------------------------------------------------------------

export function eq(property: string, value: string | number | boolean | CQL2Date | CQL2Timestamp): CQL2Expression {
  return { op: '=', args: [{ property }, value] };
}

export function neq(property: string, value: string | number | boolean): CQL2Expression {
  return { op: '<>', args: [{ property }, value] };
}

export function gt(property: string, value: number | CQL2Date | CQL2Timestamp): CQL2Expression {
  return { op: '>', args: [{ property }, value] };
}

export function gte(property: string, value: number | CQL2Date | CQL2Timestamp): CQL2Expression {
  return { op: '>=', args: [{ property }, value] };
}

export function lt(property: string, value: number | CQL2Date | CQL2Timestamp): CQL2Expression {
  return { op: '<', args: [{ property }, value] };
}

export function lte(property: string, value: number | CQL2Date | CQL2Timestamp): CQL2Expression {
  return { op: '<=', args: [{ property }, value] };
}

export function between(property: string, lower: number, upper: number): CQL2Expression {
  // Use gte+lte instead of the 'between' op — tipg/pygeofilter doesn't handle 'between' correctly
  return { op: 'and', args: [gte(property, lower), lte(property, upper)] };
}

// ---------------------------------------------------------------------------
// Pattern / array builders
// ---------------------------------------------------------------------------

/** LIKE pattern match. Use `%` as wildcard, e.g. `like('name', '%France%')`. */
export function like(property: string, pattern: string): CQL2Expression {
  return { op: 'like', args: [{ property }, pattern] };
}

/** Checks if a property value is in a list. Named inList to avoid reserved word. */
export function inList(property: string, values: (string | number)[]): CQL2Expression {
  return { op: 'in', args: [{ property }, values] };
}

export function isNull(property: string): CQL2Expression {
  return { op: 'isNull', args: [{ property }] };
}

// ---------------------------------------------------------------------------
// Logical builders
// ---------------------------------------------------------------------------

/**
 * Combines expressions with AND. Filters out null/undefined entries.
 * Returns null if no valid expressions remain.
 */
export function and(...expressions: (CQL2Expression | null | undefined)[]): CQL2Expression | null {
  const valid = expressions.filter((e): e is CQL2Expression => e != null);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  return { op: 'and', args: valid };
}

/**
 * Combines expressions with OR. Filters out null/undefined entries.
 * Returns null if no valid expressions remain.
 */
export function or(...expressions: (CQL2Expression | null | undefined)[]): CQL2Expression | null {
  const valid = expressions.filter((e): e is CQL2Expression => e != null);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  return { op: 'or', args: valid };
}

export function not(expression: CQL2Expression): CQL2Expression {
  return { op: 'not', args: [expression] };
}

// ---------------------------------------------------------------------------
// Temporal builders
// ---------------------------------------------------------------------------

export function tAfter(property: string, dateOrTimestamp: CQL2Date | CQL2Timestamp): CQL2Expression {
  return { op: 't_after', args: [{ property }, dateOrTimestamp] };
}

export function tBefore(property: string, dateOrTimestamp: CQL2Date | CQL2Timestamp): CQL2Expression {
  return { op: 't_before', args: [{ property }, dateOrTimestamp] };
}

export function tDuring(
  property: string,
  start: CQL2Date | CQL2Timestamp,
  end: CQL2Date | CQL2Timestamp,
): CQL2Expression {
  const startStr = 'date' in start ? start.date : start.timestamp;
  const endStr = 'date' in end ? end.date : end.timestamp;
  return { op: 't_during', args: [{ property }, { interval: [startStr, endStr] }] };
}

// ---------------------------------------------------------------------------
// Spatial builders
// ---------------------------------------------------------------------------

/** GeoJSON geometry type for spatial CQL2 args. */
export type CQL2Geometry = {
  type: string;
  coordinates: unknown;
};

/** S_INTERSECTS — tests whether two geometries share any portion of space. */
export function sIntersects(property: string, geometry: CQL2Geometry): CQL2Expression {
  return { op: 's_intersects', args: [{ property }, geometry] };
}

/** S_WITHIN — tests whether the first geometry is completely within the second. */
export function sWithin(property: string, geometry: CQL2Geometry): CQL2Expression {
  return { op: 's_within', args: [{ property }, geometry] };
}

/**
 * Converts distance values to turf-compatible units (kilometers or miles).
 * Turf's buffer function accepts: 'kilometers', 'miles', 'degrees', etc.
 */
function convertDistanceForTurf(distance: number, units: string): { value: number; turfUnits: 'kilometers' | 'miles' } {
  switch (units) {
    case 'meters': return { value: distance / 1000, turfUnits: 'kilometers' };
    case 'feet': return { value: distance / 5280, turfUnits: 'miles' };
    case 'kilometers': return { value: distance, turfUnits: 'kilometers' };
    case 'miles': return { value: distance, turfUnits: 'miles' };
    default: return { value: distance / 1000, turfUnits: 'kilometers' };
  }
}

/**
 * S_DWITHIN — tests whether two geometries are within a specified distance.
 * tipg/pygeofilter doesn't support s_dwithin directly, so we buffer the
 * geometry client-side using turf and use s_intersects instead.
 */
export function sDwithin(property: string, geometry: CQL2Geometry, distance: number, units: string = 'meters'): CQL2Expression {
  // Use s_intersects with buffered geometry — tipg doesn't handle s_dwithin
  const { value, turfUnits } = convertDistanceForTurf(distance, units);
  if (value > 0) {
    const buffered = turfBuffer(geometry as GeoJSON.Geometry, value, { units: turfUnits });
    if (buffered) {
      return sIntersects(property, buffered.geometry as CQL2Geometry);
    }
  }
  // Fallback: distance=0 or buffer failed — use plain s_intersects
  return sIntersects(property, geometry);
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Converts a simple key-value filter record to a CQL2 expression.
 * Each entry becomes an equality check; multiple entries are combined with AND.
 * Returns null if the record is empty.
 */
export function fromSimpleFilters(
  filters: Record<string, string | number>,
): CQL2Expression | null {
  const expressions = Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([property, value]) => eq(property, value));

  return and(...expressions);
}

/**
 * Converts structured `SearchFilterValues` (with typed shapes) to a CQL2 expression.
 * Uses field configs to determine the right operator per field type.
 * Returns null if no active filters remain.
 */
export function fromStructuredFilters(
  filters: Record<string, import('../types').SearchFilterValue>,
  fields: import('../types').SearchField[],
): CQL2Expression | null {
  const fieldMap = new Map(fields.map((f) => [f.property, f]));

  const expressions = Object.entries(filters).map(([property, value]) => {
    if (value === undefined) return null;

    const field = fieldMap.get(property);

    // Category field: value is a group id; compile to CQL2 via the group's match rule
    if (field?.type === 'category' && typeof value === 'string') {
      const catField = field as import('../types').CategorySearchField;
      const group = catField.categoryGroups.find((g) => g.id === value);
      if (!group) return null;
      return categoryGroupToCql2Inline(group, property);
    }

    // Plain string
    if (typeof value === 'string') {
      if (value === '') return null;
      if (field?.type === 'datetime') return eq(property, { timestamp: value });
      return eq(property, value);
    }

    // Plain number
    if (typeof value === 'number') {
      return eq(property, value);
    }

    // Object shapes
    if (typeof value === 'object') {
      // { start, end } — datetime range
      if ('start' in value || 'end' in value) {
        const { start, end } = value as { start: string; end: string };
        if (start && end) return tDuring(property, { timestamp: start }, { timestamp: end });
        if (start) return tAfter(property, { timestamp: start });
        if (end) return tBefore(property, { timestamp: end });
        return null;
      }

      // { value, operator }
      if ('value' in value && 'operator' in value) {
        const { value: v, operator } = value as { value: number; operator: string };
        if (v === undefined || v === null || String(v) === '') return null;
        switch (operator) {
          case 'gt':  return gt(property, v);
          case 'lt':  return lt(property, v);
          case 'gte': return gte(property, v);
          case 'lte': return lte(property, v);
          default:    return eq(property, v);
        }
      }

      // { min, max }
      if ('min' in value && 'max' in value) {
        const { min, max } = value as { min: number; max: number };
        if (min === undefined || max === undefined) return null;
        return between(property, min, max);
      }
    }

    return null;
  });

  return and(...expressions);
}

/** Serializes a CQL2 expression to a JSON string for use as a query parameter. */
export function serializeCql2(expr: CQL2Expression): string {
  return JSON.stringify(expr);
}

// ---------------------------------------------------------------------------
// Category group → CQL2 (inline, avoids circular import with categoryGroups.ts)
// ---------------------------------------------------------------------------

function categoryGroupToCql2Inline(
  group: import('../types').CategoryGroup,
  property: string,
): CQL2Expression | null {
  const rule = group.matchRule;
  if (rule.kind === 'catchAll') return null;
  if (rule.kind === 'values') {
    if (rule.values.length === 0) return null;
    if (rule.values.length === 1) return eq(property, rule.values[0] as string | number);
    return inList(property, rule.values as (string | number)[]);
  }
  // pattern
  const { operator, pattern } = rule;
  switch (operator) {
    case 'contains':     return like(property, `%${pattern}%`);
    case 'not_contains': return not(like(property, `%${pattern}%`));
    case 'startsWith':   return like(property, `${pattern}%`);
    case 'endsWith':     return like(property, `%${pattern}`);
    case 'equals':       return eq(property, pattern);
    case 'not_equals':   return neq(property, pattern);
    default:             return null;
  }
}

// ---------------------------------------------------------------------------
// Filter Rule Group → CQL2 conversion
// ---------------------------------------------------------------------------

import type {
  FilterRule,
  FilterRuleGroup,
  FilterRuleValue,
  RelativeDateValue,
  Cql2QueryShape,
} from '../types';

function resolveOffsetValue(
  offset: { kind: 'static'; value: number } | { kind: 'parameter'; name: string; label: string; default?: number },
  params?: Record<string, unknown>,
): number {
  if (offset.kind === 'parameter') {
    return (params?.[offset.name] as number) ?? offset.default ?? 0;
  }
  return offset.value;
}

/**
 * Resolves a relative date value (e.g., "3 years ago") to an ISO timestamp string.
 * Supports parameterized offsets resolved from `params`. The optional `now` parameter
 * overrides the current date (useful for testing).
 */
export function resolveRelativeDate(
  value: RelativeDateValue,
  params?: Record<string, unknown>,
  now?: Date,
): string {
  const base = now ?? new Date();
  const offset = resolveOffsetValue(value.offset, params);
  const sign = value.direction === 'past' ? -1 : 1;
  const result = new Date(base);
  switch (value.unit) {
    case 'days':   result.setDate(result.getDate() + sign * offset); break;
    case 'months': result.setMonth(result.getMonth() + sign * offset); break;
    case 'years':  result.setFullYear(result.getFullYear() + sign * offset); break;
  }
  return result.toISOString();
}

function resolveDateEndpoint(
  endpoint: { kind: 'static'; value: string } | RelativeDateValue | { kind: 'parameter'; name: string; label: string; default?: string },
  params?: Record<string, unknown>,
  now?: Date,
): string {
  if (endpoint.kind === 'relativeDate') {
    return resolveRelativeDate(endpoint, params, now);
  }
  if (endpoint.kind === 'parameter') {
    const resolved = params?.[endpoint.name] ?? endpoint.default;
    return (resolved as string) ?? `{{${endpoint.name}}}`;
  }
  return endpoint.value;
}

function resolveValue(
  value: FilterRuleValue,
  params?: Record<string, unknown>,
): unknown {
  if (value.kind === 'parameter') {
    const resolved = params?.[value.name] ?? value.default;
    return resolved ?? `{{${value.name}}}`;
  }
  if (value.kind === 'relativeDate') {
    return resolveRelativeDate(value, params);
  }
  if (value.kind === 'static') {
    return value.value;
  }
  // dateRange and computedRange are handled specially in filterRuleToCql2
  return null;
}

export function isFilterRuleGroup(item: FilterRule | FilterRuleGroup): item is FilterRuleGroup {
  return 'combinator' in item;
}

/**
 * Resolves a value that may be either a literal or a `{kind:'parameter'}` reference
 * against a runtime params dict, falling back to the parameter's default and then `fallback`.
 */
function resolveParam<T>(
  value: T | { kind: 'parameter'; name: string; default?: T } | undefined,
  params: Record<string, unknown> | undefined,
  fallback: T,
): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object' && (value as { kind?: string }).kind === 'parameter') {
    const ref = value as { name: string; default?: T };
    return (params?.[ref.name] as T) ?? ref.default ?? fallback;
  }
  return value as T;
}

function resolveSpatialDistance(
  spatial: FilterRule['spatial'],
  params?: Record<string, unknown>,
): number {
  return resolveParam(spatial?.distance, params, 0);
}

function filterRuleToCql2(
  rule: FilterRule,
  params?: Record<string, unknown>,
  selectionGeometry?: CQL2Geometry | null,
): CQL2Expression | null {
  const { property, operator, spatial } = rule;

  switch (operator) {
    case '=':       return eq(property, resolveValue(rule.value, params) as string | number | boolean);
    case '<>':      return neq(property, resolveValue(rule.value, params) as string | number | boolean);
    case '>':       return gt(property, resolveValue(rule.value, params) as number);
    case '>=':      return gte(property, resolveValue(rule.value, params) as number);
    case '<':       return lt(property, resolveValue(rule.value, params) as number);
    case '<=':      return lte(property, resolveValue(rule.value, params) as number);
    case 'like':    return like(property, `%${resolveValue(rule.value, params) as string}%`);
    case 'in':      return inList(property, resolveValue(rule.value, params) as (string | number)[]);
    case 'isNull':  return isNull(property);
    case 'between': {
      // Computed range: "within N% of X"
      if (rule.value.kind === 'computedRange') {
        const base = (params?.[rule.value.baseParam] as number) ?? 0;
        const offsetAmt = resolveOffsetValue(rule.value.offsetAmount, params);
        let lower: number, upper: number;
        if (rule.value.offsetType === 'percentage') {
          lower = base * (1 - offsetAmt / 100);
          upper = base * (1 + offsetAmt / 100);
        } else {
          lower = base - offsetAmt;
          upper = base + offsetAmt;
        }
        return between(property, lower, upper);
      }
      const v = resolveValue(rule.value, params) as { lower: number; upper: number };
      return between(property, v.lower, v.upper);
    }
    case 't_after': {
      const ts = resolveValue(rule.value, params) as string;
      return tAfter(property, { timestamp: ts });
    }
    case 't_before': {
      const ts = resolveValue(rule.value, params) as string;
      return tBefore(property, { timestamp: ts });
    }
    case 't_during': {
      // DateRange kind: each endpoint resolved independently
      if (rule.value.kind === 'dateRange') {
        const startTs = resolveDateEndpoint(rule.value.start, params);
        const endTs = resolveDateEndpoint(rule.value.end, params);
        return tDuring(property, { timestamp: startTs }, { timestamp: endTs });
      }
      const v = resolveValue(rule.value, params) as { start: string; end: string };
      return tDuring(property, { timestamp: v.start }, { timestamp: v.end });
    }
    case 's_intersects': {
      if (!selectionGeometry) return null;
      return sIntersects(property, selectionGeometry);
    }
    case 's_within': {
      if (!selectionGeometry) return null;
      return sWithin(property, selectionGeometry);
    }
    case 's_dwithin': {
      if (!selectionGeometry) return null;
      const dist = resolveSpatialDistance(spatial, params);
      return sDwithin(property, selectionGeometry, dist, spatial?.units ?? 'meters');
    }
    default:
      return null;
  }
}

/**
 * Converts a FilterRuleGroup (visual query builder model) to a CQL2Expression.
 *
 * @param group - The rule group to convert
 * @param params - Runtime parameter values (for parameterized templates)
 * @param selectionGeometry - Geometry from selected feature(s) for spatial operators
 * @returns CQL2Expression or null if the group produces no valid expressions
 */
export function fromFilterRuleGroup(
  group: FilterRuleGroup,
  params?: Record<string, unknown>,
  selectionGeometry?: CQL2Geometry | null,
): CQL2Expression | null {
  const expressions = group.rules.map((item) => {
    if (isFilterRuleGroup(item)) {
      return fromFilterRuleGroup(item, params, selectionGeometry);
    }
    return filterRuleToCql2(item, params, selectionGeometry);
  });

  return group.combinator === 'and' ? and(...expressions) : or(...expressions);
}

/**
 * Builds a full query shape from a FilterRuleGroup, including sort and limit metadata.
 * Use this when you need the complete query (filter + sort + limit) rather than just the CQL2 filter.
 */
export function buildCql2Query(
  group: FilterRuleGroup,
  params?: Record<string, unknown>,
  selectionGeometry?: CQL2Geometry | null,
): Cql2QueryShape {
  let filter = fromFilterRuleGroup(group, params, selectionGeometry);

  // Auto-add spatial constraint when selection geometry exists
  if (selectionGeometry && group.spatialConstraint) {
    const { operator, geometryProperty, distance, distanceUnits } = group.spatialConstraint;
    let spatial: CQL2Expression;
    switch (operator) {
      case 's_within':
        spatial = sWithin(geometryProperty, selectionGeometry);
        break;
      case 's_dwithin':
        spatial = sDwithin(
          geometryProperty,
          selectionGeometry,
          resolveParam(distance, params, 0),
          resolveParam(distanceUnits, params, 'meters'),
        );
        break;
      default: // s_intersects
        spatial = sIntersects(geometryProperty, selectionGeometry);
    }
    filter = filter ? and(filter, spatial)! : spatial;
  }

  return { filter, sortby: group.sortby, limit: group.limit };
}
