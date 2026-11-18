import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Button, Chip } from '../../../shared/ui';
import { HeaderBackButton, HeaderSpacer } from '../../../shared/ui/HeaderBackButton';
import { colors, radii, spacing, typography } from '../../../theme';
import { RootStackParamList } from '../../../app/navigation/routes';
import { useBillsStore } from '../state/billsStore';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { activeAccounts, accountDisplayLabel } from '../../../domain/accounts/account.rules';
import { BillKind } from '../../../domain/bills/bill.types';
import { BILL_KIND_OPTIONS } from '../billLabels';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function rupeesToMinor(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

function minorToRupees(minor: number | null): string {
  return minor == null ? '' : (minor / 100).toString();
}

export function AddBillScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'EditBill'>>();
  const billId = route.params && 'billId' in route.params ? route.params.billId : undefined;
  const bills = useBillsStore(state => state.bills);
  const addBill = useBillsStore(state => state.addBill);
  const editBill = useBillsStore(state => state.editBill);
  const accounts = useTransactionsStore(state => activeAccounts(state.accounts));
  const existing = billId ? bills.find(b => b.id === billId) ?? null : null;

  const [payee, setPayee] = useState(existing?.payee ?? '');
  const [kind, setKind] = useState<BillKind>(existing?.kind ?? 'manual');
  const [accountId, setAccountId] = useState<string | null>(existing?.accountId ?? null);
  const [amount, setAmount] = useState(minorToRupees(existing?.amountDueMinor ?? null));
  const [minDue, setMinDue] = useState(minorToRupees(existing?.minDueMinor ?? null));
  const [dueDate, setDueDate] = useState<Date | null>(
    existing?.dueDate ? new Date(existing.dueDate) : null,
  );
  const [repeatMonthly, setRepeatMonthly] = useState(existing?.repeat === 'monthly');
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountMinor = rupeesToMinor(amount);
  const canSave = payee.trim() !== '' && amountMinor != null && dueDate != null;

  function onPickerChange(_event: DateTimePickerEvent, date?: Date) {
    setShowPicker(false);
    if (date) setDueDate(date);
  }

  async function onSave() {
    if (!canSave || amountMinor == null || dueDate == null) {
      setError('Enter a payee, amount and due date.');
      return;
    }
    const minDueMinor = minDue.trim() === '' ? null : rupeesToMinor(minDue);
    if (existing) {
      await editBill(existing, {
        payee: payee.trim(),
        amountDueMinor: amountMinor,
        minDueMinor,
        dueDate: dueDate.toISOString(),
        accountId,
        repeat: repeatMonthly ? 'monthly' : 'none',
      });
    } else {
      await addBill({
        accountId,
        kind,
        payee: payee.trim(),
        amountDueMinor: amountMinor,
        minDueMinor,
        statementDate: null,
        dueDate: dueDate.toISOString(),
        source: 'manual',
        sourceHash: null,
        repeat: repeatMonthly ? 'monthly' : 'none',
      });
    }
    navigation.goBack();
  }

  const accountOptions = useMemo(
    () => [{ id: null as string | null, label: 'No account' }, ...accounts.map(a => ({ id: a.id, label: accountDisplayLabel(a) }))],
    [accounts],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>{existing ? 'Edit bill' : 'Add bill'}</Text>
        <HeaderSpacer />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Payee</Text>
        <TextInput
          style={styles.input}
          value={payee}
          onChangeText={setPayee}
          placeholder="e.g. QA Electric Board"
          placeholderTextColor={colors.outline}
          testID="bill-payee-input"
        />

        {!existing ? (
          <>
            <Text style={styles.label}>Type</Text>
            <View style={styles.wrapRow} accessibilityRole="radiogroup">
              {BILL_KIND_OPTIONS.map(option => (
                <Pressable
                  key={option.value}
                  onPress={() => setKind(option.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: kind === option.value }}
                  accessibilityLabel={option.label}>
                  <Chip label={option.label} tone={kind === option.value ? 'active' : 'neutral'} />
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Account (optional)</Text>
        <View style={styles.wrapRow} accessibilityRole="radiogroup">
          {accountOptions.map(option => (
            <Pressable
              key={option.id ?? 'none'}
              onPress={() => setAccountId(option.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: accountId === option.id }}
              accessibilityLabel={option.label}>
              <Chip label={option.label} tone={accountId === option.id ? 'active' : 'neutral'} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Amount due (₹)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          placeholderTextColor={colors.outline}
          keyboardType="decimal-pad"
          testID="bill-amount-input"
        />

        <Text style={styles.label}>Minimum due (₹, optional)</Text>
        <TextInput
          style={styles.input}
          value={minDue}
          onChangeText={setMinDue}
          placeholder=""
          placeholderTextColor={colors.outline}
          keyboardType="decimal-pad"
          testID="bill-min-due-input"
        />

        <Text style={styles.label}>Due date</Text>
        <Pressable
          onPress={() => setShowPicker(true)}
          style={styles.input}
          accessibilityRole="button"
          accessibilityLabel="Pick due date"
          testID="bill-due-date">
          <Text style={{ color: dueDate ? colors.onSurface : colors.outline }}>
            {dueDate ? dueDate.toLocaleDateString('en-IN') : 'Pick a date'}
          </Text>
        </Pressable>
        {showPicker ? (
          <DateTimePicker value={dueDate ?? new Date()} mode="date" onChange={onPickerChange} />
        ) : null}

        <Pressable
          onPress={() => setRepeatMonthly(v => !v)}
          style={styles.repeatRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: repeatMonthly }}
          accessibilityLabel="Repeat monthly">
          <Chip label={repeatMonthly ? '☑ Repeat monthly' : '☐ Repeat monthly'} tone={repeatMonthly ? 'active' : 'neutral'} />
          <Text style={styles.repeatHint}>When paid, next month's bill is created.</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={existing ? 'Save changes' : 'Add bill'}
          variant="brand"
          onPress={onSave}
          style={styles.save}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, flex: 1, textAlign: 'center' },
  content: { padding: spacing.screen, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  label: { ...typography.labelLg, color: colors.outline, letterSpacing: 0.5, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  repeatRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, minHeight: 48 },
  repeatHint: { ...typography.bodyMd, color: colors.outline, flex: 1 },
  error: { ...typography.bodyMd, color: colors.error, marginTop: spacing.sm },
  save: { marginTop: spacing.md },
});
