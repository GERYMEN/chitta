import React, { useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, DefaultTheme, NavigationContainer, Theme } from '@react-navigation/native';
import { navigationRef } from '../navigation/navigationRef';
import { useColors, useTheme } from '../../theme';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const { mode } = useTheme();
  // R12: navigation chrome (card background, header, borders) follows the active palette.
  const navTheme = useMemo<Theme>(() => {
    const base = mode === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: c.primary,
        background: c.background,
        card: c.surface,
        text: c.onSurface,
        border: c.outlineVariant,
        notification: c.error,
      },
    };
  }, [c, mode]);
  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} theme={navTheme}>
        {children}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
