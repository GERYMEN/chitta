import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { useTransferPairs } from '../useTransferPairs';
import { possibleTransfersLabel } from '../transferLabels';

/**
 * R3a Home nudge: "N possible transfers — Review ›" (pairs of pending OR
 * approved rows). Renders nothing when N is 0.
 */
export function PossibleTransfersCard({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const count = useTransferPairs().length;
  if (count === 0) return null;
  const label = possibleTransfersLabel(count);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Review`}
      testID="possible-transfers-card"
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>
      <View style={styles.icon}>
        <Icon name="swap-horizontal" size={20} color={colors.secondary} />
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
