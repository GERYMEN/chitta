import { createContext } from 'react';
import { ColorTokens, lightColors } from './colors';
import { radii } from './radii';
import { shadows } from './shadows';
import { spacing } from './spacing';
import { typography } from './typography';
import { ResolvedMode } from './themeMode';

export interface ThemeValue {
  colors: ColorTokens;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  shadows: typeof shadows;
  mode: ResolvedMode;
}

/** Default (no provider, e.g. isolated tests) = the light palette. */
export const ThemeContext = createContext<ThemeValue>({
  colors: lightColors,
  spacing,
  radii,
  typography,
  shadows,
  mode: 'light',
});
