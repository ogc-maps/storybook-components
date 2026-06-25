import { buildCategoricalCaseTest, type CategoricalMatchType } from './expressionColors';

export interface MatchPair<TOutput> {
  value: string;
  output: TOutput;
  matchType: CategoricalMatchType;
}

export interface InterpolateStop<TOutput> {
  stop: number;
  output: TOutput;
}

/**
 * Parses the test-half of a `case` expression pair, as emitted by the categorical
 * editor. Supports equals (`['==', ['get', p], v]`) and case-insensitive contains
 * (`['in', ['downcase', v], ['downcase', ['to-string', ['get', p]]]]`). Returns null
 * for anything else so unknown `case` shapes aren't silently misparsed.
 */
export function parseCaseTest(
  test: unknown,
): { property: string; value: string; matchType: CategoricalMatchType } | null {
  if (!Array.isArray(test)) return null;
  if (test[0] === '==' && Array.isArray(test[1]) && test[1][0] === 'get' && typeof test[1][1] === 'string') {
    return { property: test[1][1], value: String(test[2] ?? ''), matchType: 'equals' };
  }
  if (
    test[0] === 'in' &&
    Array.isArray(test[1]) && test[1][0] === 'downcase' && typeof test[1][1] === 'string' &&
    Array.isArray(test[2]) && test[2][0] === 'downcase' &&
    Array.isArray(test[2][1]) && test[2][1][0] === 'to-string' &&
    Array.isArray(test[2][1][1]) && test[2][1][1][0] === 'get' && typeof test[2][1][1][1] === 'string'
  ) {
    return { property: test[2][1][1][1], value: test[1][1] as string, matchType: 'contains' };
  }
  return null;
}

/**
 * Parses a `match` or `case` expression (the two shapes the categorical editor
 * produces) into a property/pairs/fallback triple using the caller-supplied
 * output parser. Works for any output type (color, number, icon name).
 */
export function parseMatchExpression<TOutput>(
  expr: unknown[],
  parseOutput: (raw: unknown) => TOutput,
  defaultFallback: TOutput,
): { property: string; pairs: MatchPair<TOutput>[]; fallback: TOutput } {
  if (expr[0] === 'case') {
    const pairs: MatchPair<TOutput>[] = [];
    let property = '';
    for (let i = 1; i < expr.length - 1; i += 2) {
      const parsed = parseCaseTest(expr[i]);
      if (!parsed) continue;
      if (!property) property = parsed.property;
      pairs.push({ value: parsed.value, output: parseOutput(expr[i + 1]), matchType: parsed.matchType });
    }
    return { property, pairs, fallback: parseOutput(expr[expr.length - 1] ?? defaultFallback) };
  }
  const property = Array.isArray(expr[1]) ? ((expr[1][1] as string) ?? '') : '';
  const fallback = parseOutput(expr[expr.length - 1] ?? defaultFallback);
  const pairs: MatchPair<TOutput>[] = [];
  for (let i = 2; i < expr.length - 1; i += 2) {
    pairs.push({
      value: String(expr[i] ?? ''),
      output: parseOutput(expr[i + 1]),
      matchType: 'equals',
    });
  }
  return { property, pairs, fallback };
}

/**
 * Builds a numeric ramp of `count` evenly-spaced values for auto-populating a
 * data-driven number editor (e.g. line-width-by-category). Values run from
 * `minWidth` to `maxWidth` inclusive, rounded to 1 decimal place.
 *
 * - count 0 → []
 * - count 1 → [minWidth]
 * - otherwise → linearly spaced minWidth..maxWidth
 *
 * If `maxWidth` isn't provided, it defaults to `minWidth + count - 1` so each
 * category gets a visibly distinct width even without explicit bounds.
 */
export function buildNumberRamp(count: number, minWidth = 1, maxWidth?: number): number[] {
  if (count <= 0) return [];
  const lo = Number.isFinite(minWidth) ? minWidth : 1;
  const hi = maxWidth !== undefined && Number.isFinite(maxWidth) ? maxWidth : lo + count - 1;
  if (count === 1) return [lo];
  const span = hi - lo;
  return Array.from({ length: count }, (_, i) => {
    const v = lo + (span * i) / (count - 1);
    return Math.round(v * 10) / 10;
  });
}

/** Builds a `match` (or `case`, if any pair uses contains) expression. */
export function buildMatchExpression<TOutput>(
  property: string,
  pairs: MatchPair<TOutput>[],
  fallback: TOutput,
  serializeOutput: (v: TOutput) => unknown,
): unknown[] {
  const hasContains = pairs.some((p) => p.matchType === 'contains');
  if (!hasContains) {
    const flat: unknown[] = ['match', ['get', property]];
    for (const p of pairs) flat.push(p.value, serializeOutput(p.output));
    flat.push(serializeOutput(fallback));
    return flat;
  }
  const flat: unknown[] = ['case'];
  for (const p of pairs) {
    flat.push(buildCategoricalCaseTest(property, p.value, p.matchType), serializeOutput(p.output));
  }
  flat.push(serializeOutput(fallback));
  return flat;
}

/** Parses an `['interpolate', ['linear'], getter, stop1, out1, ...]` expression. */
export function parseInterpolateExpression<TOutput>(
  expr: unknown[],
  parseOutput: (raw: unknown) => TOutput,
): { property: string; stops: InterpolateStop<TOutput>[] } {
  const getter = expr[2];
  let property = '';
  if (Array.isArray(getter)) {
    if (getter[0] === 'to-number' && Array.isArray(getter[1])) {
      property = (getter[1][1] as string) ?? '';
    } else {
      property = (getter[1] as string) ?? '';
    }
  }
  const stops: InterpolateStop<TOutput>[] = [];
  for (let i = 3; i < expr.length; i += 2) {
    stops.push({ stop: Number(expr[i] ?? 0), output: parseOutput(expr[i + 1]) });
  }
  return { property, stops };
}

/** Builds an `['interpolate', ['linear'], ['to-number', ['get', property]], ...]` expression. */
export function buildInterpolateExpression<TOutput>(
  property: string,
  stops: InterpolateStop<TOutput>[],
  serializeOutput: (v: TOutput) => unknown,
): unknown[] {
  const flat: unknown[] = ['interpolate', ['linear'], ['to-number', ['get', property]]];
  for (const s of stops) flat.push(s.stop, serializeOutput(s.output));
  return flat;
}
