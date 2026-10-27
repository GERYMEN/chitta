import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { useShallow } from 'zustand/react/shallow';
import { selectActiveAccounts, useTransactionsStore } from '../state/transactionsStore';
import { CreateTransactionInput } from '../../../data/repositories/transaction.repository';
import { RootStackParamList } from '../../../app/navigation/routes';
import { TransactionForm } from '../components/TransactionForm';
import { amountInputToMinor, TransactionFormValues } from '../components/transactionForm.schema';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Manual transaction entry (docs/PROJECT.md §23). Creates a `pending`
 * transaction through the same Detect → Review → Approve → Record flow as
 * SMS-detected entries — never approved directly.
 */
export function AddRecordScreen() {
  const navigation = useNavigation<Nav>();
  // D10: only active accounts count for the "add an account first" guard.
  const accounts = useTransactionsStore(useShallow(selectActiveAccounts));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: TransactionFormValues) {
    const now = new Date().toISOString();
    const input: CreateTransactionInput = {
      type: values.type,
      status: 'pending',
      amountMinor: amountInputToMinor(values.amount),
      currency: 'INR',
      merchantName: values.merchantName,
      categoryId: values.categoryId,
      accountId: values.accountId,
      paymentMethod: values.paymentMethod,
      occurredAt: values.occurredAt,
      detectedAt: now,
      approvedAt: null,
      note: values.note && values.note.trim() !== '' ? values.note : null,
      sourceType: 'manual',
      sourceReferenceHash: null,
      sanitizedPreview: null,
      confidenceScore: null,
      parserVersion: null,
    };

    setSubmitting(true);
    try {
      await useTransactionsStore.getState().addTransaction(input);
      navigation.navigate('Tabs', { screen: 'Pending' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Icon name="arrow-left" size={22} color={colors.onSurface} onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Add Record</Text>
        <View style={styles.headerSpacer} />
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
      ) : (
        <TransactionForm onSubmit={handleSubmit} submitting={submitting} />
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
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  headerSpacer: {
    width: 22,
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
