import type { CQL2Expression } from './cql2';
import { like, inList, not, eq, neq } from './cql2';
import type { CategoryGroup, CategoryMatchRule } from '../types';

/**
 * Compiles a single CategoryMatchRule to a CQL2 expression for a given property.
 * Returns null for `catchAll` rules (they are the else-branch, not a positive condition).
 */
export function categoryMatchRuleToCql2(
  rule: CategoryMatchRule,
  property: string,
): CQL2Expression | null {
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

/**
 * Compiles a CategoryGroup to a CQL2 expression.
 * Returns null for catchAll groups.
 */
export function categoryGroupToCql2(
  group: CategoryGroup,
  property: string,
): CQL2Expression | null {
  return categoryMatchRuleToCql2(group.matchRule, property);
}

/**
 * Builds a MapLibre `case` expression that maps category groups to colors.
 *
 * The last group with kind `catchAll` becomes the fallback color. When no
 * catchAll group is present, `fallbackColor` is used.
 *
 * Returned value has the shape:
 *   ["case", condition1, color1, condition2, color2, ..., fallbackColor]
 */
export function categoryGroupsToMaplibreExpression(
  groups: CategoryGroup[],
  property: string,
  fallbackColor: string,
): unknown[] {
  const cases: unknown[] = ['case'];
  let catchAllColor: string | undefined;

  for (const group of groups) {
    const { kind } = group.matchRule;
    if (kind === 'catchAll') {
      catchAllColor = group.color;
      continue;
    }
    const condition = buildMaplibreCondition(group.matchRule, property);
    if (condition) {
      cases.push(condition, group.color);
    }
  }

  cases.push(catchAllColor ?? fallbackColor);
  return cases;
}

function buildMaplibreCondition(rule: CategoryMatchRule, property: string): unknown[] | null {
  if (rule.kind === 'catchAll') return null;

  if (rule.kind === 'values') {
    if (rule.values.length === 0) return null;
    if (rule.values.length === 1) return ['==', ['get', property], rule.values[0]];
    return ['in', ['get', property], ['literal', rule.values]];
  }

  const { operator, pattern } = rule;
  switch (operator) {
    case 'contains':
      return ['in', pattern, ['get', property]];
    case 'not_contains':
      return ['!', ['in', pattern, ['get', property]]];
    case 'startsWith':
      return ['==', ['slice', ['get', property], 0, pattern.length], pattern];
    case 'endsWith':
      return ['==', ['slice', ['get', property], ['-', ['length', ['get', property]], pattern.length]], pattern];
    case 'equals':
      return ['==', ['get', property], pattern];
    case 'not_equals':
      return ['!=', ['get', property], pattern];
    default:
      return null;
  }
}
