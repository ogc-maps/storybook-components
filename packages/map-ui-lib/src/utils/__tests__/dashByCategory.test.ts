import { describe, it, expect } from 'vitest';
import { expandDashByCategory, slugifyDashCaseValue } from '../dashByCategory';
import type { LineStyle } from '../../types';

const baseLineStyle: LineStyle = {
  type: 'line',
  paint: { 'line-color': '#000', 'line-width': 1 },
};

describe('slugifyDashCaseValue', () => {
  it('preserves alphanumeric and casing', () => {
    expect(slugifyDashCaseValue('NO')).toBe('NO');
    expect(slugifyDashCaseValue('no')).toBe('no');
    expect(slugifyDashCaseValue('Interstate')).toBe('Interstate');
    expect(slugifyDashCaseValue(42)).toBe('42');
  });

  it('replaces non-alphanumerics with underscore', () => {
    expect(slugifyDashCaseValue('US Hwy 50')).toBe('US_Hwy_50');
    expect(slugifyDashCaseValue('a/b.c')).toBe('a_b_c');
  });
});

describe('expandDashByCategory', () => {
  it('returns empty array for line style without dashByCategory', () => {
    expect(expandDashByCategory(baseLineStyle)).toEqual([]);
  });

  it('returns empty array when cases array is empty', () => {
    const style: LineStyle = {
      ...baseLineStyle,
      dashByCategory: { property: 'class', cases: [] },
    };
    expect(expandDashByCategory(style)).toEqual([]);
  });

  it('produces one sub-layer per case with stable id and equality filter', () => {
    const style: LineStyle = {
      ...baseLineStyle,
      dashByCategory: {
        property: 'roadclass',
        cases: [
          { value: 'interstate', dasharray: [1, 0] },
          { value: 'primary', dasharray: [4, 2] },
        ],
      },
    };
    const result = expandDashByCategory(style);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      idSuffix: 'dash--interstate',
      dasharray: [1, 0],
      filter: ['==', ['get', 'roadclass'], 'interstate'],
      label: 'interstate',
      value: 'interstate',
    });
    expect(result[1].idSuffix).toBe('dash--primary');
    expect(result[1].filter).toEqual(['==', ['get', 'roadclass'], 'primary']);
  });

  it('appends a default-case sub-layer with negated filter when default dasharray is set', () => {
    const style: LineStyle = {
      ...baseLineStyle,
      dashByCategory: {
        property: 'class',
        cases: [
          { value: 'A', dasharray: [1, 0] },
          { value: 'B', dasharray: [3, 3] },
        ],
        default: [1, 4],
      },
    };
    const result = expandDashByCategory(style);
    expect(result).toHaveLength(3);
    const def = result[2];
    expect(def.idSuffix).toBe('dash--default');
    expect(def.dasharray).toEqual([1, 4]);
    expect(def.value).toBeNull();
    expect(def.filter).toEqual([
      'any',
      ['!', ['has', 'class']],
      ['==', ['get', 'class'], null],
      ['all', ['!=', ['get', 'class'], 'A'], ['!=', ['get', 'class'], 'B']],
    ]);
  });

  it('default-case filter structurally catches missing/null values', () => {
    const style: LineStyle = {
      ...baseLineStyle,
      dashByCategory: {
        property: 'class',
        cases: [
          { value: 'highway', dasharray: [1, 0] },
          { value: 'primary', dasharray: [3, 3] },
        ],
        default: [1, 4],
      },
    };
    const result = expandDashByCategory(style);
    const def = result.find((r) => r.idSuffix === 'dash--default');
    expect(def).toBeDefined();
    const filter = def!.filter as unknown[];
    // Structural shape: an `any` head with branches covering
    // missing, null, and the negated case-value list — not an `all`-of-`!=`s.
    expect(filter[0]).toBe('any');
    expect(filter).toContainEqual(['!', ['has', 'class']]);
    expect(filter).toContainEqual(['==', ['get', 'class'], null]);
    // One of the branches is an `all`-of-`!=` over the case values.
    const allBranch = filter.find(
      (b) => Array.isArray(b) && (b as unknown[])[0] === 'all',
    ) as unknown[] | undefined;
    expect(allBranch).toBeDefined();
    expect(allBranch!.length).toBe(1 /* 'all' */ + 2 /* case values */);
  });

  it('omits default-case sub-layer when no default dasharray provided', () => {
    const style: LineStyle = {
      ...baseLineStyle,
      dashByCategory: {
        property: 'class',
        cases: [{ value: 'A', dasharray: [1, 0] }],
      },
    };
    const result = expandDashByCategory(style);
    expect(result).toHaveLength(1);
    expect(result[0].idSuffix).toBe('dash--A');
  });

  it('handles numeric case values', () => {
    const style: LineStyle = {
      ...baseLineStyle,
      dashByCategory: {
        property: 'lanes',
        cases: [
          { value: 1, dasharray: [1, 0] },
          { value: 2, dasharray: [2, 2] },
        ],
        default: [4, 4],
      },
    };
    const result = expandDashByCategory(style);
    expect(result.map((r) => r.idSuffix)).toEqual(['dash--1', 'dash--2', 'dash--default']);
    expect(result[2].filter).toEqual([
      'any',
      ['!', ['has', 'lanes']],
      ['==', ['get', 'lanes'], null],
      ['all', ['!=', ['get', 'lanes'], 1], ['!=', ['get', 'lanes'], 2]],
    ]);
  });

  it('slugifies special characters in case values for stable ids', () => {
    const style: LineStyle = {
      ...baseLineStyle,
      dashByCategory: {
        property: 'route',
        cases: [{ value: 'US Hwy 50', dasharray: [1, 0] }],
      },
    };
    const result = expandDashByCategory(style);
    expect(result[0].idSuffix).toBe('dash--US_Hwy_50');
    // The filter still uses the original value, not the slug
    expect(result[0].filter).toEqual(['==', ['get', 'route'], 'US Hwy 50']);
  });

  it('dedupes idSuffix when distinct case values slugify to the same string', () => {
    const style: LineStyle = {
      ...baseLineStyle,
      dashByCategory: {
        property: 'route',
        cases: [
          { value: 'US Hwy 50', dasharray: [1, 0] },
          { value: 'US-Hwy-50', dasharray: [4, 2] },
        ],
      },
    };
    const result = expandDashByCategory(style);
    const ids = result.map((r) => r.idSuffix);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['dash--US_Hwy_50', 'dash--US_Hwy_50-2']);
    // Filters still discriminate on the original, un-slugified values.
    expect(result[0].filter).toEqual(['==', ['get', 'route'], 'US Hwy 50']);
    expect(result[1].filter).toEqual(['==', ['get', 'route'], 'US-Hwy-50']);
  });

  it('dedupes idSuffix when a case value literally slugifies to "default"', () => {
    const style: LineStyle = {
      ...baseLineStyle,
      dashByCategory: {
        property: 'class',
        cases: [{ value: 'default', dasharray: [1, 0] }],
        default: [4, 4],
      },
    };
    const result = expandDashByCategory(style);
    const ids = result.map((r) => r.idSuffix);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['dash--default', 'dash--default-2']);
    // The case layer (not the default layer) keeps the un-suffixed id.
    expect(result[0].value).toBe('default');
    expect(result[1].value).toBeNull();
  });
});
