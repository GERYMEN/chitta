import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../../../theme';
import { shadows } from '../../../theme/shadows';
import { useSnackbarStore } from './snackbarStore';
import { useRedacted } from '../../privacy/redaction';

/**
 * Mount once at the app root (next to DialogHost). Obsidian pill above the
 * tab bar / gesture zone with one optional action (e.g. "Undo").
 */
export function SnackbarHost() {
  const current = useSnackbarStore(state => state.current);
  const press = useSnackbarStore(state => state.press);
  const insets = useSafeAreaInsets();
  // R4c: a snackbar message is precomputed text (may name a merchant or an
  // amount) — keep it out of the feedback screenshot entirely.
  const redacted = useRedacted();
  if (!current || redacted) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + 72 }]}
      testID="snackbar">
      <View style={[styles.bar, shadows.level2]} accessibilityLiveRegion="polite">
        <Text style={styles.message} numberOfLines={2}>
          {current.message}
        </Text>
        {current.actionLabel ? (
          <Pressable
            onPress={press}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={current.actionLabel}
            testID="snackbar-action">
            <Text style={styles.actionLabel}>{current.actionLabel.toUpperCase()}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: radii.default,
    backgroundColor: colors.obsidian,
  },
  message: {
    ...typography.bodyMd,
    color: colors.onObsidian,
    flex: 1,
  },
  action: {
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  actionLabel: {
    ...typography.labelLg,
    color: colors.primaryFixedDim,
  },
});
