import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';

export interface MerchantHistoryChipProps {
  /** merchantChipLabel(...): "1 visit · ₹200 this month". */
  label: string;
  onPress: () => void;
}

/**
 * R4 (T5) Transaction-detail chip: this merchant's approved rows in the
 * selected period. Tap → Transactions filtered by the merchant key.
 * 48dp touch target.
 */
export function MerchantHistoryChip({ label, onPress }: MerchantHistoryChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Show these transactions`}
      testID="merchant-history-chip"
      style={({ pressed }) => [styles.target, pressed && styles.pressed]}>
      <Icon name="storefront-outline" size={16} color={colors.onSecondaryContainer} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.xs,
    minHeight: 48,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.secondaryContainer,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    ...typography.labelLg,
    color: colors.onSurface,
    flexShrink: 1,
  },
  chevron: {
    ...typography.labelLg,
    color: colors.secondary,
  },
});
