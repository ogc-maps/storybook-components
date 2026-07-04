import { getColorFromTheme, type ColorThemeId } from './colorThemes';

/**
 * Returns a color from the categorical palette, optionally scoped to a theme.
 * Cycles when index exceeds palette length.
 *
 * @deprecated Use `getColorFromTheme` from `./colorThemes` directly — this
 * wrapper exists only for backwards compatibility and will be removed in a
 * future major release.
 */
export function getColorFromPalette(index: number, theme?: ColorThemeId): string {
  return getColorFromTheme(index, theme);
}
