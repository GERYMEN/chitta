import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { PaymentMethod, TransactionType } from '../../../domain/transactions/transaction.types';
import { Account } from '../../../domain/accounts/account.types';
import {
  accountDisplayLabel,
  activeAccounts,
  isDeletedAccount,
} from '../../../domain/accounts/account.rules';
import { useTransactionsStore } from '../state/transactionsStore';
import {
  transactionFormSchema,
  TransactionFormInitialValues,
  TransactionFormValues,
} from './transactionForm.schema';

const TYPE_OPTIONS: Array<{ value: TransactionType; label: string }> = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
];

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export interface TransactionFormProps {
  onSubmit: (values: TransactionFormValues) => void;
  initialValues?: TransactionFormInitialValues;
  submitting?: boolean;
}

/**
 * Dumb, reusable transaction form shared by Add Record and Edit Transaction.
 * Owns only validation + field state; the calling screen decides what to do
 * with the validated values.
 */
export function TransactionForm({ onSubmit, initialValues, submitting = false }: TransactionFormProps) {
  const allAccounts = useTransactionsStore(state => state.accounts);
  // D10: the picker only offers active accounts.
  const accounts = useMemo(() => activeAccounts(allAccounts), [allAccounts]);
  // D10: editing a transaction whose account was removed — keep it as the
  // current selection (never silently reassign) and say so.
  const initialAccountId = initialValues?.accountId;
  const deletedCurrentAccount = useMemo(
    () =>
      initialAccountId
        ? allAccounts.find(a => a.id === initialAccountId && isDeletedAccount(a))
        : undefined,
    [allAccounts, initialAccountId],
  );
  const categories = useTransactionsStore(state => state.categories);

  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: {
      type: initialValues?.type ?? 'expense',
      amount: initialValues?.amount ?? '',
      merchantName: initialValues?.merchantName ?? '',
      categoryId: initialValues?.categoryId ?? '',
      accountId: initialValues?.accountId ?? '',
      paymentMethod: initialValues?.paymentMethod ?? 'upi',
      occurredAt: initialValues?.occurredAt ?? new Date().toISOString(),
      note: initialValues?.note ?? '',
    },
  });

  const type = watch('type');
  const occurredAt = watch('occurredAt');
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);

  const filteredCategories = useMemo(
    () =>
      categories.filter(c =>
        type === 'expense' ? c.type === 'expense' || c.type === 'both' : c.type === 'income' || c.type === 'both',
      ),
    [categories, type],
  );

  useEffect(() => {
    const current = getValues('categoryId');
    if (current && !filteredCategories.some(c => c.id === current)) {
      setValue('categoryId', '', { shouldValidate: true });
    }
  }, [filteredCategories, getValues, setValue]);

  function handlePickerChange(event: DateTimePickerEvent, date?: Date) {
    const mode = picker;
    setPicker(null);
    if (event.type !== 'set' || !date) return;

    const current = new Date(getValues('occurredAt') || Date.now());
    const next = new Date(current);
    if (mode === 'date') {
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    } else {
      next.setHours(date.getHours(), date.getMinutes(), 0, 0);
    }
    setValue('occurredAt', next.toISOString(), { shouldValidate: true, shouldDirty: true });
  }

  const occurredDate = new Date(occurredAt);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <FieldLabel>Type</FieldLabel>
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <View style={styles.chipRow}>
            {TYPE_OPTIONS.map(option => (
              <Pressable key={option.value} onPress={() => field.onChange(option.value)}>
                <Chip label={option.label} tone={field.value === option.value ? 'active' : 'neutral'} />
              </Pressable>
            ))}
          </View>
        )}
      />

      <FieldLabel>Amount (₹)</FieldLabel>
      <Controller
        control={control}
        name="amount"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="e.g. 450.50"
            placeholderTextColor={colors.outline}
            keyboardType="decimal-pad"
            testID="transaction-amount-input"
          />
        )}
      />
      <FieldError error={errors.amount?.message} />

      <FieldLabel>Merchant / Description</FieldLabel>
      <Controller
        control={control}
        name="merchantName"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="e.g. Swiggy"
            placeholderTextColor={colors.outline}
            testID="transaction-merchant-input"
          />
        )}
      />
      <FieldError error={errors.merchantName?.message} />

      <FieldLabel>Category</FieldLabel>
      <Controller
        control={control}
        name="categoryId"
        render={({ field }) => (
          <View style={styles.wrapRow}>
            {filteredCategories.map(category => (
              <Pressable key={category.id} onPress={() => field.onChange(category.id)}>
                <Chip label={category.name} tone={field.value === category.id ? 'active' : 'neutral'} />
              </Pressable>
            ))}
          </View>
        )}
      />
      <FieldError error={errors.categoryId?.message} />

      <FieldLabel>Account</FieldLabel>
      <Controller
        control={control}
        name="accountId"
        render={({ field }) => (
          <View style={styles.accountList}>
            {deletedCurrentAccount ? (
              <Pressable
                onPress={() => field.onChange(deletedCurrentAccount.id)}
                style={[styles.accountOption, styles.deletedAccountOption]}
                accessibilityRole="radio"
                accessibilityState={{ checked: field.value === deletedCurrentAccount.id }}>
                <Icon
                  name={field.value === deletedCurrentAccount.id ? 'radiobox-marked' : 'radiobox-blank'}
                  size={20}
                  color={colors.outline}
                />
                <View style={styles.accountMeta}>
                  <Text style={styles.accountName}>{accountDisplayLabel(deletedCurrentAccount)}</Text>
                  <Text style={styles.accountSubtitle}>
                    This account was removed. The record stays on it unless you pick another account.
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {accounts.map(account => (
              <AccountOption
                key={account.id}
                account={account}
                selected={field.value === account.id}
                onPress={() => field.onChange(account.id)}
              />
            ))}
          </View>
        )}
      />
      <FieldError error={errors.accountId?.message} />

      <FieldLabel>Payment Method</FieldLabel>
      <Controller
        control={control}
        name="paymentMethod"
        render={({ field }) => (
          <View style={styles.wrapRow}>
            {PAYMENT_METHOD_OPTIONS.map(option => (
              <Pressable key={option.value} onPress={() => field.onChange(option.value)}>
                <Chip label={option.label} tone={field.value === option.value ? 'active' : 'neutral'} />
              </Pressable>
            ))}
          </View>
        )}
      />

      <FieldLabel>Date & Time</FieldLabel>
      <View style={styles.dateRow}>
        <Pressable style={styles.dateButton} onPress={() => setPicker('date')}>
          <Icon name="calendar-outline" size={18} color={colors.primary} />
          <Text style={styles.dateButtonText}>
            {occurredDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
        </Pressable>
        <Pressable style={styles.dateButton} onPress={() => setPicker('time')}>
          <Icon name="clock-outline" size={18} color={colors.primary} />
          <Text style={styles.dateButtonText}>
            {occurredDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
          </Text>
        </Pressable>
      </View>

      <FieldLabel>Note (optional)</FieldLabel>
      <Controller
        control={control}
        name="note"
        render={({ field }) => (
          <TextInput
            style={[styles.input, styles.noteInput]}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="Add a personal note"
            placeholderTextColor={colors.outline}
            multiline
          />
        )}
      />

      <Button
        label={submitting ? 'Saving…' : 'Save'}
        variant="brand"
        loading={submitting}
        onPress={() => handleSubmit(onSubmit)()}
        style={styles.submit}
      />

      {picker ? (
        <DateTimePicker
          value={occurredDate}
          mode={picker}
          onChange={handlePickerChange}
        />
      ) : null}
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

function AccountOption({
  account,
  selected,
  onPress,
}: {
  account: Account;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.accountOption}>
      <Icon
        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
        size={20}
        color={selected ? colors.primary : colors.outline}
      />
      <View style={styles.accountMeta}>
        <Text style={styles.accountName}>{account.name}</Text>
        <Text style={styles.accountSubtitle}>
          {account.lastFour ? `•••• ${account.lastFour}` : 'Physical wallet'}
        </Text>
      </View>
    </Pressable>
  );
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
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
  noteInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  accountList: {
    gap: spacing.sm,
  },
  accountOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  accountMeta: {
    flex: 1,
  },
  deletedAccountOption: {
    opacity: 0.7,
    borderStyle: 'dashed',
  },
  accountName: {
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  accountSubtitle: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  dateButtonText: {
    ...typography.bodyMd,
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
