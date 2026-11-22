import React, { useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { useTransferPairs } from '../../transfers/useTransferPairs';
import { useDuplicatePairs } from '../../duplicates/useDuplicatePairs';
import { toReviewLabel } from '../../duplicates/duplicateLabels';
import { useMeaningReviewItems } from '../../meaning/useMeaningReview';

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
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const transferPairs = useTransferPairs();
  const duplicatePairs = useDuplicatePairs();
  // R5e T5: + money meanings waiting on approved rows.
  const meaningItems = useMeaningReviewItems();
  const count = transferPairs.length + duplicatePairs.length + meaningItems.length;
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
        <Icon name="clipboard-check-outline" size={20} color={c.secondary} />
      </View>
      <Text style={styles.text}>{label}</Text>
      <Text style={styles.link}>Review ›</Text>
    </Pressable>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radii.default,
    backgroundColor: c.secondaryContainer,
  },
  pressed: {
    opacity: 0.7,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    ...typography.labelLg,
    color: c.onSurface,
    flex: 1,
  },
  link: {
    ...typography.labelLg,
    color: c.secondary,
  },
});
