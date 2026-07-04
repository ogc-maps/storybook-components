import { describe, it, expect } from 'vitest';
import {
  COLOR_THEMES,
  COLOR_THEME_IDS,
  getThemePalette,
  getColorFromTheme,
} from '../colorThemes';

describe('COLOR_THEMES', () => {
  it('has an entry for every id listed in COLOR_THEME_IDS', () => {
    for (const id of COLOR_THEME_IDS) {
      expect(COLOR_THEMES[id], `missing theme: ${id}`).toBeDefined();
    }
  });

  it('every theme has a non-empty palette of hex strings', () => {
    for (const id of COLOR_THEME_IDS) {
      const { palette } = COLOR_THEMES[id];
      expect(palette.length, `${id} palette is empty`).toBeGreaterThan(0);
      for (const color of palette) {
        expect(color, `${id}: "${color}" not a hex color`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe('getThemePalette', () => {
  it('returns the default palette when no theme is supplied', () => {
    expect(getThemePalette()).toBe(COLOR_THEMES.default.palette);
  });

  it('returns the correct palette for each named theme', () => {
    for (const id of COLOR_THEME_IDS) {
      expect(getThemePalette(id)).toBe(COLOR_THEMES[id].palette);
    }
  });

  it('falls back to the default palette for an unrecognised theme id', () => {
    expect(getThemePalette('unknown' as never)).toBe(COLOR_THEMES.default.palette);
  });
});

describe('getColorFromTheme', () => {
  it('index 0 returns the first color of the default palette', () => {
    expect(getColorFromTheme(0)).toBe(COLOR_THEMES.default.palette[0]);
  });

  it('index equal to palette length wraps back to index 0', () => {
    const len = COLOR_THEMES.default.palette.length;
    expect(getColorFromTheme(len)).toBe(COLOR_THEMES.default.palette[0]);
  });

  it('index beyond palette length wraps via modulo', () => {
    const palette = COLOR_THEMES.earth.palette;
    expect(getColorFromTheme(palette.length + 3, 'earth')).toBe(palette[3]);
  });

  it('uses the supplied theme palette', () => {
    expect(getColorFromTheme(0, 'accessible')).toBe(COLOR_THEMES.accessible.palette[0]);
    expect(getColorFromTheme(1, 'ocean')).toBe(COLOR_THEMES.ocean.palette[1]);
  });
});
