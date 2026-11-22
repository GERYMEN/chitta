import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';

export type ChipTone = 'neutral' | 'active' | 'approved' | 'pending' | 'rejected' | 'failed';

export interface ChipProps {
  label: string;
  tone?: ChipTone;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Compact 36px pill per DESIGN.md §Chips & Filters. State tones map to the
 * transaction-state matrix (approved/pending/rejected/failed).
 */
export function Chip({ label, tone = 'neutral', icon, style }: ChipProps) {
  const c = useColors();
  const toneStyle = useMemo(() => makeToneStyles(c)[tone], [c, tone]);

  return (
    <View style={[styles.base, toneStyle.container, style]}>
      {icon}
      <Text style={[styles.label, toneStyle.label, icon ? styles.labelWithIcon : null]}>
        {label}
      </Text>
    </View>
  );
}

const makeToneStyles = (
  c: ColorTokens,
): Record<ChipTone, { container: ViewStyle; label: { color: string } }> => ({
  neutral: {
    container: { backgroundColor: c.surfaceContainerLowest, borderWidth: StyleSheet.hairlineWidth, borderColor: c.outlineVariant },
    label: { color: c.onSurfaceVariant },
  },
  active: {
    container: { backgroundColor: c.obsidian },
    label: { color: c.onObsidian },
  },
  approved: {
    container: { backgroundColor: c.approvedBg },
    label: { color: c.approvedFg },
  },
  pending: {
    container: { backgroundColor: c.pendingBg },
    label: { color: c.pendingFg },
  },
  rejected: {
    container: { backgroundColor: c.rejectedBg },
    label: { color: c.rejectedFg },
  },
  failed: {
    container: { backgroundColor: c.failedBg },
    label: { color: c.failedFg },
  },
});

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
  },
  label: {
    ...typography.labelMd,
  },
  labelWithIcon: {
    marginLeft: spacing.xs,
  },
});
