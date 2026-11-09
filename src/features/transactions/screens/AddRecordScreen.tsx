import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, HeaderBackButton, HeaderSpacer } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { useShallow } from 'zustand/react/shallow';
import { selectActiveAccounts, TransferInput, useTransactionsStore } from '../state/transactionsStore';
import { CreateTransactionInput } from '../../../data/repositories/transaction.repository';
import { RootStackParamList } from '../../../app/navigation/routes';
import { TransactionForm } from '../components/TransactionForm';
import { TransferForm } from '../components/TransferForm';
import {
  amountInputToMinor,
  minorToAmountInput,
  TransactionFormInitialValues,
  TransactionFormValues,
  TransferFormValues,
} from '../components/transactionForm.schema';
import { FromSmsPrefill } from '../../../app/navigation/routes';
import { formatRupeesPlain } from '../../../shared/utils/currency';
import { Account } from '../../../domain/accounts/account.types';
import { SMS_USER_ADDED_PARSER_VERSION } from '../../sms-sync/smsSyncLogic';
import { useSmsReaderStore } from '../../sms-sync/smsReaderStore';

/**
 * R5: form values from a "Messages not understood" best guess. The account
 * is pre-picked only when exactly one active account has that last-4.
 */
export function prefillFromSms(
  fromSms: FromSmsPrefill,
  accounts: ReadonlyArray<Pick<Account, 'id' | 'lastFour'>>,
): TransactionFormInitialValues {
  const matches = fromSms.lastFour ? accounts.filter(a => a.lastFour === fromSms.lastFour) : [];
  return {
    type: fromSms.type ?? 'expense',
    amount: fromSms.amountMinor != null ? minorToAmountInput(fromSms.amountMinor) : undefined,
    occurredAt: new Date(fromSms.smsDate).toISOString(),
    accountId: matches.length === 1 ? matches[0].id : undefined,
  };
}

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * R5-fix U9: a transfer added from "Messages not understood" keeps the SMS
 * reference, exactly like an expense / income added from there.
 */
export function transferInputFor(
  values: TransferFormValues,
  fromSms: Pick<FromSmsPrefill, 'smsId' | 'smsDate'> | null,
): TransferInput {
  return {
    fromAccountId: values.fromAccountId,
    toAccountId: values.toAccountId,
    amountMinor: amountInputToMinor(values.amount),
    occurredAt: values.occurredAt,
    note: values.note && values.note.trim() !== '' ? values.note.trim() : null,
    smsReference: fromSms
      ? { hash: `sms-${fromSms.smsId}-${fromSms.smsDate}`, parserVersion: SMS_USER_ADDED_PARSER_VERSION }
      : null,
  };
}

/**
 * Manual transaction entry (docs/PROJECT.md §23). R5 (owner, 2026-11-06):
 * the user typed and confirmed the values, so the record is saved APPROVED
 * (counted in totals and balances at once, audited 'added' by the user) — no
 * second check in Pending. SMS-detected items still go to Pending. Manual
 * items that were already pending before R5 are left as they are.
 *
 * R3a: the Type row's third tab "Transfer" swaps in the transfer form. A
 * transfer is the owner moving their own money (not a detection), so it is
 * recorded approved and never counts as income or expense.
 */
export function AddRecordScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddRecord'>>();
  const fromSms = route.params?.fromSms ?? null;
  // D10: only active accounts count for the "add an account first" guard.
  const accounts = useTransactionsStore(useShallow(selectActiveAccounts));
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<'expense' | 'income' | 'transfer'>(fromSms?.type ?? 'expense');

  async function handleTransferSubmit(values: TransferFormValues) {
    setSubmitting(true);
    try {
      await useTransactionsStore.getState().addTransfer(transferInputFor(values, fromSms));
      // R5-fix U9: the SMS is recorded — it leaves "Messages not understood".
      if (fromSms) {
        await useSmsReaderStore
          .getState()
          .resolveUnparsed({ smsId: fromSms.smsId, smsDate: fromSms.smsDate })
          .catch(() => undefined);
      }
      navigation.navigate('Tabs', { screen: 'Transactions' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(values: TransactionFormValues) {
    const now = new Date().toISOString();
    // R5 (owner, 2026-11-06): what the user types needs no second check —
    // saved approved, counted in totals and balances at once, audited 'added'.
    const input: CreateTransactionInput = {
      type: values.type,
      status: 'approved',
      amountMinor: amountInputToMinor(values.amount),
      currency: 'INR',
      merchantName: values.merchantName,
      categoryId: values.categoryId,
      accountId: values.accountId,
      paymentMethod: values.paymentMethod,
      occurredAt: values.occurredAt,
      detectedAt: now,
      approvedAt: now,
      note: values.note && values.note.trim() !== '' ? values.note : null,
      sourceType: 'manual',
      sourceReferenceHash: null,
      sanitizedPreview: null,
      confidenceScore: null,
      parserVersion: null,
      // R5: added from "Messages not understood" — keeps the SMS reference
      // (dedupe on later syncs + "View original SMS"); audited 'added' (user).
      ...(fromSms
        ? {
            sourceType: 'sms' as const,
            sourceReferenceHash: `sms-${fromSms.smsId}-${fromSms.smsDate}`,
            sanitizedPreview: `${values.type === 'expense' ? 'Debited' : 'Credited'} ${formatRupeesPlain(
              amountInputToMinor(values.amount),
            )} — ${values.merchantName}`,
            parserVersion: SMS_USER_ADDED_PARSER_VERSION,
          }
        : {}),
    };

    setSubmitting(true);
    try {
      await useTransactionsStore.getState().addTransaction(input);
      if (fromSms) {
        await useSmsReaderStore
          .getState()
          .resolveUnparsed({ smsId: fromSms.smsId, smsDate: fromSms.smsDate })
          .catch(() => undefined);
      }
      navigation.navigate('Tabs', { screen: 'Transactions' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Add Record</Text>
        <HeaderSpacer />
      </View>

      {accounts.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="wallet-outline" size={40} color={colors.outline} />
          <Text style={styles.emptyTitle}>Add an account first</Text>
          <Text style={styles.emptyBody}>
            Every transaction belongs to an account. Add a money source before
            recording your first transaction.
          </Text>
          <Button
            label="Go to Accounts"
            variant="brand"
            onPress={() => navigation.navigate('Tabs', { screen: 'Accounts' })}
            style={styles.emptyButton}
          />
        </View>
      ) : mode === 'transfer' ? (
        <TransferForm
          onSubmit={handleTransferSubmit}
          submitting={submitting}
          onChooseType={setMode}
        />
      ) : (
        <TransactionForm
          key={mode}
          onSubmit={handleSubmit}
          submitting={submitting}
          initialValues={
            fromSms
              ? { ...prefillFromSms(fromSms, accounts), type: mode }
              : { type: mode }
          }
          onChooseTransfer={() => setMode('transfer')}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // B2: the 48dp back button centres its arrow ~13dp in from its edge.
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  emptyBody: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: spacing.md,
  },
});
