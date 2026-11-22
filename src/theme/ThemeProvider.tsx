import React, { useEffect, useMemo } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { darkColors, lightColors } from './colors';
import { radii } from './radii';
import { shadows } from './shadows';
import { spacing } from './spacing';
import { typography } from './typography';
import { resolveThemeMode, useThemeModeStore } from './themeMode';
import { ThemeContext, ThemeValue } from './themeContext';

/**
 * R12: resolves the saved setting (+ the live OS scheme for 'system') to a
 * palette and shares it. Spacing / radii / typography / shadows never change
 * by mode.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const setting = useThemeModeStore(s => s.mode);
  const scheme = useColorScheme();
  const mode = resolveThemeMode(setting, scheme);
  // Keep native chrome (text-input handles, system dialogs) in step with an explicit choice;
  // 'auto' hands control back to the phone's own setting.
  useEffect(() => {
    try {
      Appearance.setColorScheme(setting === 'system' ? 'auto' : setting);
    } catch {
      // Older/unsupported runtime: the JS palette still flips.
    }
  }, [setting]);
  const value = useMemo<ThemeValue>(
    () => ({
      colors: mode === 'dark' ? darkColors : lightColors,
      spacing,
      radii,
      typography,
      shadows,
      mode,
    }),
    [mode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
