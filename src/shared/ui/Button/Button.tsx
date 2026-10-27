import React from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../../theme';

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
}: ButtonProps) {
  const variantStyle = VARIANT_STYLES[variant];

  return (
    <Pressable
      accessibilityRole="button"
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

const VARIANT_STYLES: Record<ButtonVariant, { container: ViewStyle; label: { color: string } }> = {
  primary: {
    container: { backgroundColor: colors.obsidian },
    label: { color: colors.onObsidian },
  },
  brand: {
    container: { backgroundColor: colors.primaryContainer },
    label: { color: colors.obsidian },
  },
  ghost: {
    container: { backgroundColor: colors.surfaceContainerHigh },
    label: { color: colors.onSurface },
  },
  destructive: {
    container: { backgroundColor: colors.errorContainer },
    label: { color: colors.onErrorContainer },
  },
};

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
