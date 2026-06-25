import { describe, it, expect } from 'vitest';
import {
  parseCaseTest,
  parseMatchExpression,
  buildMatchExpression,
  parseInterpolateExpression,
  buildInterpolateExpression,
  buildNumberRamp,
  type MatchPair,
  type InterpolateStop,
} from '../dataDrivenExpressions';

const numberParser = (raw: unknown): number =>
  typeof raw === 'number' ? raw : Number(raw ?? 0);
const stringParser = (raw: unknown): string => (typeof raw === 'string' ? raw : '');

describe('parseCaseTest', () => {
  it('parses equals test', () => {
    const result = parseCaseTest(['==', ['get', 'kind'], 'park']);
    expect(result).toEqual({ property: 'kind', value: 'park', matchType: 'equals' });
  });

  it('parses case-insensitive contains test', () => {
    const result = parseCaseTest([
      'in',
      ['downcase', 'park'],
      ['downcase', ['to-string', ['get', 'name']]],
    ]);
    expect(result).toEqual({ property: 'name', value: 'park', matchType: 'contains' });
  });

  it('returns null for unknown shapes', () => {
    expect(parseCaseTest(['!=', ['get', 'x'], 'y'])).toBeNull();
    expect(parseCaseTest('not an array')).toBeNull();
  });
});

describe('match expression roundtrip (numeric)', () => {
  it('preserves pairs and fallback through build -> parse', () => {
    const pairs: MatchPair<number>[] = [
      { value: 'small', output: 2, matchType: 'equals' },
      { value: 'large', output: 10, matchType: 'equals' },
    ];
    const expr = buildMatchExpression('size', pairs, 4, (v) => v);
    expect(expr[0]).toBe('match');
    const parsed = parseMatchExpression(expr, numberParser, 0);
    expect(parsed.property).toBe('size');
    expect(parsed.fallback).toBe(4);
    expect(parsed.pairs).toEqual(pairs);
  });

  it('builds a case expression when any pair uses contains', () => {
    const pairs: MatchPair<number>[] = [
      { value: 'park', output: 3, matchType: 'contains' },
      { value: 'road', output: 1, matchType: 'equals' },
    ];
    const expr = buildMatchExpression('name', pairs, 2, (v) => v);
    expect(expr[0]).toBe('case');
    const parsed = parseMatchExpression(expr, numberParser, 0);
    expect(parsed.property).toBe('name');
    expect(parsed.fallback).toBe(2);
    expect(parsed.pairs).toEqual(pairs);
  });
});

describe('match expression roundtrip (icon / string)', () => {
  it('preserves icon names through build -> parse', () => {
    const pairs: MatchPair<string>[] = [
      { value: 'park', output: 'tree-15', matchType: 'equals' },
      { value: 'hospital', output: 'hospital-15', matchType: 'equals' },
    ];
    const expr = buildMatchExpression('kind', pairs, 'marker-15', (v) => v);
    const parsed = parseMatchExpression(expr, stringParser, '');
    expect(parsed.property).toBe('kind');
    expect(parsed.fallback).toBe('marker-15');
    expect(parsed.pairs).toEqual(pairs);
  });
});

describe('interpolate expression roundtrip', () => {
  it('preserves stops through build -> parse', () => {
    const stops: InterpolateStop<number>[] = [
      { stop: 0, output: 1 },
      { stop: 10, output: 5 },
      { stop: 100, output: 20 },
    ];
    const expr = buildInterpolateExpression('population', stops, (v) => v);
    expect(expr[0]).toBe('interpolate');
    expect(expr[1]).toEqual(['linear']);
    expect(expr[2]).toEqual(['to-number', ['get', 'population']]);
    const parsed = parseInterpolateExpression(expr, numberParser);
    expect(parsed.property).toBe('population');
    expect(parsed.stops).toEqual(stops);
  });

  it('parses property from a plain get (no to-number wrapper)', () => {
    const expr = ['interpolate', ['linear'], ['get', 'zoom'], 0, 1, 10, 5];
    const parsed = parseInterpolateExpression(expr, numberParser);
    expect(parsed.property).toBe('zoom');
    expect(parsed.stops).toEqual([
      { stop: 0, output: 1 },
      { stop: 10, output: 5 },
    ]);
  });
});

describe('hidden / transparent color fallback', () => {
  const colorParser = (raw: unknown): string => (typeof raw === 'string' ? raw : '#000000');
  const HIDDEN = 'rgba(0,0,0,0)';

  it('round-trips a fully-transparent fallback through build -> parse -> build', () => {
    const pairs: MatchPair<string>[] = [
      { value: 'park', output: '#00ff00', matchType: 'equals' },
    ];
    const expr = buildMatchExpression('kind', pairs, HIDDEN, (v) => v);
    // Fallback is the last element of the match expression.
    expect(expr[expr.length - 1]).toBe(HIDDEN);

    const parsed = parseMatchExpression(expr, colorParser, '#000000');
    expect(parsed.fallback).toBe(HIDDEN);
    expect(parsed.pairs).toEqual(pairs);

    const rebuilt = buildMatchExpression(parsed.property, parsed.pairs, parsed.fallback, (v) => v);
    expect(rebuilt).toEqual(expr);
  });
});

describe('buildNumberRamp', () => {
  it('returns an empty ramp for zero categories', () => {
    expect(buildNumberRamp(0)).toEqual([]);
    expect(buildNumberRamp(-3)).toEqual([]);
  });

  it('returns [min] for a single category', () => {
    expect(buildNumberRamp(1, 2)).toEqual([2]);
  });

  it('spaces values evenly between min and max', () => {
    expect(buildNumberRamp(3, 1, 5)).toEqual([1, 3, 5]);
    expect(buildNumberRamp(5, 0, 10)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it('defaults max to min + count - 1 when omitted, producing distinct widths', () => {
    expect(buildNumberRamp(4, 1)).toEqual([1, 2, 3, 4]);
  });

  it('rounds to one decimal place', () => {
    const ramp = buildNumberRamp(3, 1, 2);
    expect(ramp).toEqual([1, 1.5, 2]);
  });

  it('produces a usable ramp shape for an auto-populated match expression', () => {
    const values = ['a', 'b', 'c'];
    const outputs = buildNumberRamp(values.length, 1, 7);
    const pairs: MatchPair<number>[] = values.map((v, i) => ({
      value: v,
      output: outputs[i],
      matchType: 'equals',
    }));
    const expr = buildMatchExpression('kind', pairs, 1, (v) => v);
    const parsed = parseMatchExpression(expr, (raw) => Number(raw), 0);
    expect(parsed.pairs.map((p) => p.output)).toEqual([1, 4, 7]);
  });
});

describe('parseMatchExpression with empty pairs', () => {
  it('returns empty pairs list and fallback-only expression', () => {
    const expr = buildMatchExpression<number>('size', [], 7, (v) => v);
    const parsed = parseMatchExpression(expr, numberParser, 0);
    expect(parsed.pairs).toEqual([]);
    expect(parsed.fallback).toBe(7);
  });
});
