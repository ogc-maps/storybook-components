export type ColorThemeId =
  | 'default'
  | 'earth'
  | 'ocean'
  | 'warm'
  | 'cool'
  | 'monochrome'
  | 'accessible';

export interface ColorTheme {
  id: ColorThemeId;
  label: string;
  description: string;
  palette: string[];
}

export const COLOR_THEMES: Record<ColorThemeId, ColorTheme> = {
  default: {
    id: 'default',
    label: 'Default',
    description: 'Tableau 10 categorical palette',
    palette: [
      '#4e79a7',
      '#f28e2b',
      '#e15759',
      '#76b7b2',
      '#59a14f',
      '#edc948',
      '#b07aa1',
      '#ff9da7',
      '#9c755f',
      '#bab0ac',
    ],
  },
  earth: {
    id: 'earth',
    label: 'Earth',
    description: 'Browns, greens, and tans',
    palette: [
      '#7b5e3c',
      '#a98158',
      '#c9a36b',
      '#6b8e23',
      '#4e6b30',
      '#8b7355',
      '#d2b48c',
      '#556b2f',
      '#997a58',
      '#3f5a27',
    ],
  },
  ocean: {
    id: 'ocean',
    label: 'Ocean',
    description: 'Blues, teals, and cyans',
    palette: [
      '#023e8a',
      '#0077b6',
      '#0096c7',
      '#00b4d8',
      '#48cae4',
      '#90e0ef',
      '#168aad',
      '#1a759f',
      '#34a0a4',
      '#76c893',
    ],
  },
  warm: {
    id: 'warm',
    label: 'Warm',
    description: 'Reds, oranges, and yellows',
    palette: [
      '#9e1b1b',
      '#c1292e',
      '#e94e1b',
      '#f28e2b',
      '#f4a261',
      '#f6bd60',
      '#e9c46a',
      '#c96f4a',
      '#b4452a',
      '#d68c45',
    ],
  },
  cool: {
    id: 'cool',
    label: 'Cool',
    description: 'Blues, purples, and greens',
    palette: [
      '#1d3557',
      '#2a9d8f',
      '#457b9d',
      '#5a4fcf',
      '#6a4c93',
      '#8d6e96',
      '#a8dadc',
      '#4cc9f0',
      '#7209b7',
      '#3a0ca3',
    ],
  },
  monochrome: {
    id: 'monochrome',
    label: 'Monochrome',
    description: 'Shades of gray',
    palette: [
      '#1a1a1a',
      '#333333',
      '#4d4d4d',
      '#666666',
      '#808080',
      '#999999',
      '#b3b3b3',
      '#cccccc',
      '#e0e0e0',
      '#f0f0f0',
    ],
  },
  // The Wong 2011 palette defines exactly 8 colors by design; getColorFromTheme
  // cycles via modulo so callers don't need to guard against palette length.
  accessible: {
    id: 'accessible',
    label: 'Accessible',
    description: 'Colorblind-safe (Wong 2011)',
    palette: [
      '#000000',
      '#e69f00',
      '#56b4e9',
      '#009e73',
      '#f0e442',
      '#0072b2',
      '#d55e00',
      '#cc79a7',
    ],
  },
};

export const COLOR_THEME_IDS: ColorThemeId[] = [
  'default',
  'earth',
  'ocean',
  'warm',
  'cool',
  'monochrome',
  'accessible',
];

export function getThemePalette(theme?: ColorThemeId): string[] {
  if (!theme) return COLOR_THEMES.default.palette;
  return COLOR_THEMES[theme]?.palette ?? COLOR_THEMES.default.palette;
}

export function getColorFromTheme(index: number, theme?: ColorThemeId): string {
  const palette = getThemePalette(theme);
  return palette[index % palette.length];
}
