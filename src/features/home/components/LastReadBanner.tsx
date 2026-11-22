import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { lastReadLabel } from '../../sms-sync/lastRead';

/**
 * R5j (G9): shown on Home only when no read has completed for a few days
 * (auto-read may be off, or the phone stopped it). Days only — no amounts.
 */
export function LastReadBanner({
  days,
  onSync,
  onOpenSettings,
}: {
  days: number;
  onSync: () => void;
  onOpenSettings: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.card} testID="last-read-banner">
      <View style={styles.top}>
        <Icon name="message-alert-outline" size={20} color={c.primary} />
        <Text style={styles.title}>{lastReadLabel(days)}</Text>
      </View>
      <Text style={styles.body}>
        New bank messages may be waiting. Sync now, or check that automatic reading is on.
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel="SMS settings"
          testID="last-read-settings"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.secondary}>SMS settings</Text>
        </Pressable>
        <Pressable
          onPress={onSync}
          accessibilityRole="button"
          accessibilityLabel="Sync now"
          testID="last-read-sync"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.primary}>Sync now</Text>
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
