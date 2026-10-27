import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../../../theme';

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
  return (
    <View style={[styles.base, TONE_STYLES[tone], style]} testID={testID}>
      {children}
    </View>
  );
}

const TONE_STYLES = StyleSheet.create({
  surface: {
    backgroundColor: colors.surfaceContainerLowest,
    borderColor: colors.outlineVariant,
    borderWidth: StyleSheet.hairlineWidth,
  },
  obsidian: {
    backgroundColor: colors.obsidian,
    borderWidth: 0,
  },
});

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    padding: spacing.lg,
  },
});
