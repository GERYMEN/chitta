import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { Account } from '../../../domain/accounts/account.types';
import {
  accountDisplayLabel,
  activeAccounts,
  isDeletedAccount,
} from '../../../domain/accounts/account.rules';
import { useTransactionsStore } from '../state/transactionsStore';
import {
  transferFormSchema,
  TransferFormInitialValues,
  TransferFormValues,
} from './transactionForm.schema';

export interface TransferFormProps {
  onSubmit: (values: TransferFormValues) => void;
  initialValues?: TransferFormInitialValues;
  submitting?: boolean;
  /** Add Record: the Type row's Expense/Income chips switch back to the money form. */
  onChooseType?: (type: 'expense' | 'income') => void;
}

/**
 * R3a: Add Record → Transfer and Edit transfer. From / To (active accounts,
 * must differ), amount, date, notes. No category picker — transfers always
 * use the hidden system "Transfer" category.
 */
export function TransferForm({
  onSubmit,
  initialValues,
  submitting = false,
  onChooseType,
}: TransferFormProps) {
  const allAccounts = useTransactionsStore(state => state.accounts);
  const accounts = useMemo(() => activeAccounts(allAccounts), [allAccounts]);
  // Editing a transfer whose account was later removed keeps that side selectable.
  const keptDeleted = useMemo(
    () =>
      allAccounts.filter(
        a =>
          isDeletedAccount(a) &&
          (a.id === initialValues?.fromAccountId || a.id === initialValues?.toAccountId),
      ),
    [allAccounts, initialValues?.fromAccountId, initialValues?.toAccountId],
  );
  const options = useMemo(() => [...keptDeleted, ...accounts], [keptDeleted, accounts]);

  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<TransferFormValues>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      fromAccountId: initialValues?.fromAccountId ?? '',
      toAccountId: initialValues?.toAccountId ?? '',
      amount: initialValues?.amount ?? '',
      occurredAt: initialValues?.occurredAt ?? new Date().toISOString(),
      note: initialValues?.note ?? '',
    },
  });

  const occurredAt = watch('occurredAt');
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);

  function handlePickerChange(event: DateTimePickerEvent, date?: Date) {
    const mode = picker;
    setPicker(null);
    if (event.type !== 'set' || !date) return;
    const next = new Date(getValues('occurredAt') || Date.now());
    if (mode === 'date') next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    else next.setHours(date.getHours(), date.getMinutes(), 0, 0);
    setValue('occurredAt', next.toISOString(), { shouldValidate: true, shouldDirty: true });
  }

  const occurredDate = new Date(occurredAt);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      {onChooseType ? (
        <>
          <Text style={styles.fieldLabel}>Type</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => onChooseType('expense')} accessibilityRole="button">
              <Chip label="Expense" tone="neutral" />
            </Pressable>
            <Pressable onPress={() => onChooseType('income')} accessibilityRole="button">
              <Chip label="Income" tone="neutral" />
            </Pressable>
            <Chip label="Transfer" tone="active" />
          </View>
          <Text style={styles.hint}>
            Money moved between your own accounts. Changes both balances; never counted as
            income or expense.
          </Text>
        </>
      ) : null}

      <Text style={styles.fieldLabel}>From account</Text>
      <Controller
        control={control}
        name="fromAccountId"
        render={({ field }) => (
          <View style={styles.accountList}>
            {options.map(account => (
              <AccountChoice
                key={account.id}
                side="From"
                account={account}
                selected={field.value === account.id}
                onPress={() => field.onChange(account.id)}
              />
            ))}
          </View>
        )}
      />
      <FieldError error={errors.fromAccountId?.message} />

      <Text style={styles.fieldLabel}>To account</Text>
      <Controller
        control={control}
        name="toAccountId"
        render={({ field }) => (
          <View style={styles.accountList}>
            {options.map(account => (
              <AccountChoice
                key={account.id}
                side="To"
                account={account}
                selected={field.value === account.id}
                onPress={() => field.onChange(account.id)}
              />
            ))}
          </View>
        )}
      />
      <FieldError error={errors.toAccountId?.message} />

      <Text style={styles.fieldLabel}>Amount (₹)</Text>
      <Controller
        control={control}
        name="amount"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="e.g. 500.00"
            placeholderTextColor={colors.outline}
            keyboardType="decimal-pad"
            testID="transfer-amount-input"
          />
        )}
      />
      <FieldError error={errors.amount?.message} />

      <Text style={styles.fieldLabel}>Date & Time</Text>
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

      <Text style={styles.fieldLabel}>Note (optional)</Text>
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
            testID="transfer-note-input"
          />
        )}
      />

      <Button
        label={submitting ? 'Saving…' : 'Save transfer'}
        variant="brand"
        loading={submitting}
        onPress={() => handleSubmit(onSubmit)()}
        style={styles.submit}
        testID="transfer-save"
      />

      {picker ? (
        <DateTimePicker value={occurredDate} mode={picker} onChange={handlePickerChange} />
      ) : null}
    </ScrollView>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <Text style={styles.errorText}>{error}</Text>;
}

function AccountChoice({
  side,
  account,
  selected,
  onPress,
}: {
  side: 'From' | 'To';
  account: Account;
  selected: boolean;
  onPress: () => void;
}) {
  const deleted = isDeletedAccount(account);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.accountOption, deleted && styles.deletedAccountOption]}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${side} ${account.name}`}>
      <Icon
        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
        size={20}
        color={selected ? colors.primary : colors.outline}
      />
      <View style={styles.accountMeta}>
        <Text style={styles.accountName}>{accountDisplayLabel(account)}</Text>
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
  hint: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  accountList: {
    gap: spacing.sm,
  },
  accountOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  deletedAccountOption: {
    opacity: 0.7,
    borderStyle: 'dashed',
  },
  accountMeta: {
    flex: 1,
  },
  accountName: {
    ...typography.bodyLg,
    color: colors.onSurface,
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
