import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';

export interface PasswordFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  error?: string | null;
  testID: string;
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
}

/**
 * R4e password input: secureTextEntry unless "Show" is on, no autofill /
 * autocorrect / suggestions (keeps the password out of keyboards' and
 * autofill services' memory). The value is only ever in component state.
 */
export function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggleVisible,
  error,
  testID,
  onSubmitEditing,
  autoFocus,
}: PasswordFieldProps) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.row, error ? styles.rowError : null]}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoComplete="off"
          importantForAutofill="no"
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          keyboardType={visible ? 'visible-password' : 'default'}
          accessibilityLabel={label}
          returnKeyType="done"
          onSubmitEditing={onSubmitEditing}
          autoFocus={autoFocus}
          style={styles.input}
          placeholderTextColor={c.outline}
        />
        <Pressable
          onPress={onToggleVisible}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          testID={`${testID}-toggle`}
          hitSlop={4}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
          <Icon
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color={c.onSurfaceVariant}
          />
        </Pressable>
      </View>
      {error ? (
        <Text style={styles.error} testID={`${testID}-error`} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  label: {
    ...typography.labelLg,
    color: c.onSurface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.outlineVariant,
    backgroundColor: c.surfaceContainerLowest,
    paddingLeft: spacing.md,
  },
  rowError: {
    borderColor: c.error,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 48,
    ...typography.bodyLg,
    color: c.onSurface,
  },
  toggle: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  error: {
    ...typography.bodyMd,
    color: c.error,
  },
});
