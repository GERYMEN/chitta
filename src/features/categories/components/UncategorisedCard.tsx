import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { transactionStateColors } from '../../../theme/colors';
import { uncategorisedItems } from '../../../domain/categories/category.rules';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';

/**
 * R2 T4 nudge: "N uncategorised — Categorise ›" (pending + approved). Renders
 * nothing when N is 0.
 */
export function UncategorisedCard({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const count = useTransactionsStore(state => uncategorisedItems(state.transactions).length);
  if (count === 0) return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${count} uncategorised. Categorise`}
      testID="uncategorised-card"
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>
      <View style={styles.icon}>
        <Icon name="help-circle-outline" size={20} color={transactionStateColors.pending.fg} />
      </View>
      <Text style={styles.text}>{count} uncategorised</Text>
      <Text style={styles.link}>Categorise ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radii.default,
    backgroundColor: transactionStateColors.pending.bg,
  },
  pressed: {
    opacity: 0.7,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    ...typography.labelLg,
    color: colors.onSurface,
    flex: 1,
  },
  link: {
    ...typography.labelLg,
    color: transactionStateColors.pending.fg,
  },
});
