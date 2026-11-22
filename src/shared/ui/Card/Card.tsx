import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { radii, spacing, useColors, ColorTokens } from '../../../theme';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Dark "obsidian" variant used for the Home balance card. */
  tone?: 'surface' | 'obsidian';
  testID?: string;
}

/**
 * Level-1 surface per DESIGN.md: white card, hairline border, no shadow,
 * 20-24px radius, 20px padding.
 */
export function Card({ children, style, tone = 'surface', testID }: CardProps) {
  const c = useColors();
  const TONE_STYLES = useMemo(() => makeTONE_STYLES(c), [c]);
  return (
    <View style={[styles.base, TONE_STYLES[tone], style]} testID={testID}>
      {children}
    </View>
  );
}

const makeTONE_STYLES = (c: ColorTokens) => StyleSheet.create({
  surface: {
    backgroundColor: c.surfaceContainerLowest,
    borderColor: c.outlineVariant,
    borderWidth: StyleSheet.hairlineWidth,
  },
  obsidian: {
    backgroundColor: c.obsidian,
    borderWidth: 0,
  },
});

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    padding: spacing.lg,
  },
});
