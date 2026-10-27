import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '../../../theme';
import { transactionStateColors } from '../../../theme/colors';

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
  const toneStyle = TONE_STYLES[tone];

  return (
    <View style={[styles.base, toneStyle.container, style]}>
      {icon}
      <Text style={[styles.label, toneStyle.label, icon ? styles.labelWithIcon : null]}>
        {label}
      </Text>
    </View>
  );
}

const TONE_STYLES: Record<ChipTone, { container: ViewStyle; label: { color: string } }> = {
  neutral: {
    container: { backgroundColor: colors.surfaceContainerLowest, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.outlineVariant },
    label: { color: colors.onSurfaceVariant },
  },
  active: {
    container: { backgroundColor: colors.obsidian },
    label: { color: colors.onObsidian },
  },
  approved: {
    container: { backgroundColor: transactionStateColors.approved.bg },
    label: { color: transactionStateColors.approved.fg },
  },
  pending: {
    container: { backgroundColor: transactionStateColors.pending.bg },
    label: { color: transactionStateColors.pending.fg },
  },
  rejected: {
    container: { backgroundColor: transactionStateColors.rejected.bg },
    label: { color: transactionStateColors.rejected.fg },
  },
  failed: {
    container: { backgroundColor: transactionStateColors.failed.bg },
    label: { color: transactionStateColors.failed.fg },
  },
};

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
