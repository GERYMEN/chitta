import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { useTransferPairs } from '../../transfers/useTransferPairs';
import { useDuplicatePairs } from '../../duplicates/useDuplicatePairs';
import { toReviewLabel } from '../../duplicates/duplicateLabels';

/**
 * Home nudge (R3a transfers + R3b duplicates): "N to review — Review ›",
 * N = possible transfer pairs + possible duplicate pairs (pending OR approved
 * rows). Opens the Review screen. Renders nothing when N is 0.
 */
export function ReviewCard({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const transferPairs = useTransferPairs();
  const duplicatePairs = useDuplicatePairs();
  const count = transferPairs.length + duplicatePairs.length;
  if (count === 0) return null;
  const label = toReviewLabel(count);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Review`}
      testID="review-card"
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>
      <View style={styles.icon}>
        <Icon name="clipboard-check-outline" size={20} color={colors.secondary} />
      </View>
      <Text style={styles.text}>{label}</Text>
      <Text style={styles.link}>Review ›</Text>
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
    backgroundColor: colors.secondaryContainer,
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
    color: colors.secondary,
  },
});
