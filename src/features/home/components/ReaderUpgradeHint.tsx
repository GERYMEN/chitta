import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';

/**
 * R5 one-time Home hint after the reader upgrade: re-read the sync window
 * with the new reader (items already recorded stay as they are).
 */
export function ReaderUpgradeHint({
  onReread,
  onDismiss,
}: {
  onReread: () => void;
  onDismiss: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.card} testID="reader-upgrade-hint">
      <View style={styles.top}>
        <Icon name="message-text-clock-outline" size={20} color={c.primary} />
        <Text style={styles.title}>Tracker reads bank SMS better now</Text>
      </View>
      <Text style={styles.body}>
        Re-read your messages to find transactions the old reader missed. Items already recorded
        stay as they are; anything new waits in Pending.
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          testID="reader-upgrade-dismiss"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.secondary}>Not now</Text>
        </Pressable>
        <Pressable
          onPress={onReread}
          accessibilityRole="button"
          accessibilityLabel="Re-read messages"
          testID="reader-upgrade-reread"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.primary}>Re-read messages</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  card: {
    borderRadius: radii.default,
    backgroundColor: c.surfaceContainerLow,
    padding: spacing.md,
    gap: spacing.xs,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.labelLg, color: c.onSurface, flex: 1 },
  body: { ...typography.bodyMd, color: c.onSurfaceVariant },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  action: { minHeight: 48, minWidth: 48, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  primary: { ...typography.labelLg, color: c.primary },
  secondary: { ...typography.labelLg, color: c.onSurfaceVariant },
});
