export * from './colors';
export * from './typography';
export * from './spacing';
export * from './radii';
export * from './shadows';
export { ThemeProvider } from './ThemeProvider';
export { useColors, useTheme } from './useTheme';
export type { ThemeValue } from './themeContext';
export { useThemeModeStore } from './themeMode';
export type { ThemeModeSetting, ResolvedMode } from './themeMode';

import { lightColors } from './colors';
import { typography } from './typography';
import { spacing } from './spacing';
import { radii } from './radii';
import { shadows } from './shadows';

/** Static light snapshot (type reference only; components use useTheme()). */
export const theme = {
  colors: lightColors,
  typography,
  spacing,
  radii,
  shadows,
} as const;

export type Theme = typeof theme;
