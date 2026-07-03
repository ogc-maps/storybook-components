import { describe, it, expect } from 'vitest';
import { getColorFromPalette } from '../colorPalettes';
import { getColorFromTheme } from '../colorThemes';

describe('getColorFromPalette', () => {
  it('returns the same color as getColorFromTheme with no theme', () => {
    for (let i = 0; i < 5; i++) {
      expect(getColorFromPalette(i)).toBe(getColorFromTheme(i));
    }
  });

  it('returns the same color as getColorFromTheme for a named theme', () => {
    expect(getColorFromPalette(2, 'warm')).toBe(getColorFromTheme(2, 'warm'));
  });

  it('wraps correctly when index exceeds palette length', () => {
    expect(getColorFromPalette(100, 'monochrome')).toBe(getColorFromTheme(100, 'monochrome'));
  });
});
