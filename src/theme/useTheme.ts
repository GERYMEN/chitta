import { useContext } from 'react';
import { ColorTokens } from './colors';
import { ThemeContext, ThemeValue } from './themeContext';

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/** The active palette (flips with Settings > Theme and the OS scheme). */
export function useColors(): ColorTokens {
  return useContext(ThemeContext).colors;
}
