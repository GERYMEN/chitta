import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { newAccountsLabel } from '../../sms-sync/newAccountsStore';

/**
 * R5-fix C2: Home entry for "New accounts found" that a sync (often an
 * automatic one) saw but the user has not reviewed yet. Counts only.
 */
export function NewAccountsEntry({ count, onPress }: { count: number; onPress: () => void }) {
  if (count <= 0) return null;
  const label = newAccountsLabel(count);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Review`}
      testID="home-new-accounts"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <Icon name="bank-plus" size={20} color={colors.primary} />
      <View style={styles.text}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.body}>SMS from accounts you have not added yet.</Text>
      </View>
      <Text style={styles.action}>Review</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 56,
    borderRadius: radii.default,
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  text: { flex: 1 },
  title: { ...typography.labelLg, color: colors.onSurface },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  action: { ...typography.labelLg, color: colors.primary },
});
