import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';

export type ButtonVariant = 'primary' | 'brand' | 'ghost' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress?: (event: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Spoken label when it should say more than the visible label (R5e). */
  accessibilityLabel?: string;
}

/**
 * Pill-shaped action button. Variants follow DESIGN.md §Components/Buttons:
 * - primary: obsidian fill, white label (56px) — the default CTA.
 * - brand: vibrant mint fill, obsidian label — high-importance actions.
 * - ghost: light tonal fill (48px) — secondary actions.
 * - destructive: error-container fill, error label — reject/delete.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
  icon,
  style,
  testID,
  accessibilityLabel,
}: ButtonProps) {
  const c = useColors();
  const variantStyle = useMemo(() => makeVariantStyles(c)[variant], [c, variant]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        variant === 'ghost' ? styles.ghostHeight : styles.primaryHeight,
        variantStyle.container,
        fullWidth && styles.fullWidth,
        pressed && !disabled && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variantStyle.label.color as string} />
      ) : (
        <>
          {icon}
          <Text style={[styles.label, variantStyle.label, icon ? styles.labelWithIcon : null]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const makeVariantStyles = (
  c: ColorTokens,
): Record<ButtonVariant, { container: ViewStyle; label: { color: string } }> => ({
  primary: {
    container: { backgroundColor: c.obsidian },
    label: { color: c.onObsidian },
  },
  brand: {
    container: { backgroundColor: c.primaryContainer },
    label: { color: c.obsidian },
  },
  ghost: {
    container: { backgroundColor: c.surfaceContainerHigh },
    label: { color: c.onSurface },
  },
  destructive: {
    container: { backgroundColor: c.errorContainer },
    label: { color: c.onErrorContainer },
  },
});

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
  },
  primaryHeight: {
    height: 56,
  },
  ghostHeight: {
    height: 48,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    ...typography.labelLg,
    fontSize: 16,
  },
  labelWithIcon: {
    marginLeft: spacing.xs,
  },
});
