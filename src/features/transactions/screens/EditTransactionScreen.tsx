import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../state/transactionsStore';
import { TransactionPatch } from '../../../data/repositories/transaction.repository';
import { RootStackParamList } from '../../../app/navigation/routes';
import { TransactionForm } from '../components/TransactionForm';
import { TransferForm } from '../components/TransferForm';
import { promptRememberCategory } from '../../categories/rememberCategory';
import {
  amountInputToMinor,
  minorToAmountInput,
  TransactionFormValues,
  TransferFormValues,
} from '../components/transactionForm.schema';

type EditRoute = RouteProp<RootStackParamList, 'EditTransaction'>;

export function EditTransactionScreen() {
  const navigation = useNavigation();
  const route = useRoute<EditRoute>();
  const transaction = useTransactionsStore(state =>
    state.transactions.find(t => t.id === route.params.transactionId),
  );
  const [submitting, setSubmitting] = useState(false);

  if (!transaction) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>Transaction not found.</Text>
      </View>
    );
  }

  // R3a: a transfer edits From / To / amount / date / notes (no category).
  async function handleTransferSubmit(values: TransferFormValues) {
    setSubmitting(true);
    try {
      await useTransactionsStore.getState().updateTransfer(transaction!.id, {
        fromAccountId: values.fromAccountId,
        toAccountId: values.toAccountId,
        amountMinor: amountInputToMinor(values.amount),
        occurredAt: values.occurredAt,
        note: values.note && values.note.trim() !== '' ? values.note.trim() : null,
      });
      navigation.goBack();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(values: TransactionFormValues) {
    const patch: TransactionPatch = {
      type: values.type,
      amountMinor: amountInputToMinor(values.amount),
      merchantName: values.merchantName,
      categoryId: values.categoryId,
      accountId: values.accountId,
      paymentMethod: values.paymentMethod,
      occurredAt: values.occurredAt,
      note: values.note && values.note.trim() !== '' ? values.note : null,
    };

    const before = transaction!;
    setSubmitting(true);
    try {
      await useTransactionsStore.getState().updateTransaction(before.id, patch);
      navigation.goBack();
      // R2: a category change offers "Always use <Category> for <merchant>?"
      // (uses the merchant as saved, in case it was edited too).
      promptRememberCategory({
        transactionId: before.id,
        merchantName: values.merchantName,
        previousCategoryId: before.categoryId,
        newCategoryId: values.categoryId,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Icon name="arrow-left" size={22} color={colors.onSurface} onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>
          {transaction.type === 'transfer' ? 'Edit Transfer' : 'Edit Transaction'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {transaction.type === 'transfer' ? (
        <TransferForm
          onSubmit={handleTransferSubmit}
          submitting={submitting}
          initialValues={{
            fromAccountId: transaction.accountId,
            toAccountId: transaction.transferAccountId ?? '',
            amount: minorToAmountInput(transaction.amountMinor),
            occurredAt: transaction.occurredAt,
            note: transaction.note ?? '',
          }}
        />
      ) : (
        <TransactionForm
          onSubmit={handleSubmit}
          submitting={submitting}
          initialValues={{
            type: transaction.type === 'income' ? 'income' : 'expense',
            amount: minorToAmountInput(transaction.amountMinor),
            merchantName: transaction.merchantName,
            categoryId: transaction.categoryId,
            accountId: transaction.accountId,
            paymentMethod: transaction.paymentMethod,
            occurredAt: transaction.occurredAt,
            note: transaction.note ?? '',
          }}
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
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  missingText: {
    ...typography.bodyLg,
    color: colors.outline,
  },
});
