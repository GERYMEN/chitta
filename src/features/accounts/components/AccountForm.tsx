import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Chip } from '../../../shared/ui';
import { colors, radii, spacing, typography } from '../../../theme';
import { AccountType } from '../../../domain/accounts/account.types';
import {
  accountFormSchema,
  AccountFormInitialValues,
  AccountFormValues,
} from './accountForm.schema';

const TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: 'bank', label: 'Bank Account' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'upi', label: 'UPI' },
  { value: 'other', label: 'Other' },
];

export interface AccountFormProps {
  onSubmit: (values: AccountFormValues) => void;
  initialValues?: AccountFormInitialValues;
  submitting?: boolean;
}

/**
 * Dumb, reusable account form. Owns only validation + field state; the
 * calling screen decides what to do with the validated values.
 */
export function AccountForm({ onSubmit, initialValues, submitting = false }: AccountFormProps) {
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: initialValues?.name ?? '',
      type: initialValues?.type ?? 'bank',
      lastFour: initialValues?.lastFour ?? '',
      openingBalance: initialValues?.openingBalance ?? '0',
    },
  });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <FieldLabel>Account Name</FieldLabel>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="e.g. HDFC Bank"
            placeholderTextColor={colors.outline}
            testID="account-name-input"
          />
        )}
      />
      <FieldError error={errors.name?.message} />

      <FieldLabel>Type</FieldLabel>
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <View style={styles.wrapRow}>
            {TYPE_OPTIONS.map(option => (
              <Pressable key={option.value} onPress={() => field.onChange(option.value)}>
                <Chip label={option.label} tone={field.value === option.value ? 'active' : 'neutral'} />
              </Pressable>
            ))}
          </View>
        )}
      />
      <FieldError error={errors.type?.message} />

      <FieldLabel>Last 4 / Reference (optional)</FieldLabel>
      <Controller
        control={control}
        name="lastFour"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="e.g. 1234"
            placeholderTextColor={colors.outline}
            testID="account-lastfour-input"
          />
        )}
      />
      <FieldError error={errors.lastFour?.message} />

      <FieldLabel>Opening Balance (₹)</FieldLabel>
      <Controller
        control={control}
        name="openingBalance"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="0"
            placeholderTextColor={colors.outline}
            keyboardType="decimal-pad"
            testID="account-opening-balance-input"
          />
        )}
      />
      <FieldError error={errors.openingBalance?.message} />

      <Button
        label={submitting ? 'Saving…' : 'Save Account'}
        variant="brand"
        loading={submitting}
        onPress={() => handleSubmit(onSubmit)()}
        style={styles.submit}
      />
    </ScrollView>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <Text style={styles.errorText}>{error}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    padding: spacing.screen,
    gap: spacing.sm,
    paddingBottom: spacing.xl * 2,
  },
  fieldLabel: {
    ...typography.labelLg,
    color: colors.outline,
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.error,
  },
  submit: {
    marginTop: spacing.md,
  },
});
