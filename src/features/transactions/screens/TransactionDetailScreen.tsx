import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TransactionDetailActions, TransactionDetailContent } from '../components/TransactionDetailContent';
import { Icon } from '../../../shared/icons';
import { showDialog, showSnackbar } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../state/transactionsStore';
import { RootStackParamList } from '../../../app/navigation/routes';
import { CategoryPickerSheet } from '../../categories/components/CategoryPickerSheet';
import { promptRememberCategory } from '../../categories/rememberCategory';
import { TransferAccountPickerSheet } from '../../transfers/components/TransferAccountPickerSheet';
import { findTransferTwin } from '../../../domain/transfers/transfer.rules';
import { RefundCandidateSheet } from '../../refunds/components/RefundCandidateSheet';
import { DuplicatePickerSheet } from '../../duplicates/components/DuplicatePickerSheet';
import { REFUND_LINK_ERROR_TEXT, refundsFor } from '../../../domain/refunds/refund.rules';
import { hiddenDuplicatesOf } from '../../../domain/duplicates/duplicate.rules';

type DetailRoute = RouteProp<RootStackParamList, 'TransactionDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export function TransactionDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const transaction = useTransactionsStore(state =>
    state.transactions.find(t => t.id === route.params.transactionId),
  );
  const approve = useTransactionsStore(state => state.approve);
  const reject = useTransactionsStore(state => state.reject);
  const deleteTransaction = useTransactionsStore(state => state.deleteTransaction);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [transferPickerOpen, setTransferPickerOpen] = useState(false);
  const [refundPickerOpen, setRefundPickerOpen] = useState(false);
  const [duplicatePickerOpen, setDuplicatePickerOpen] = useState(false);

  // R3b: "Link to original expense" — the refund nets out of spend.
  async function handleLinkRefund(expenseId: string) {
    setRefundPickerOpen(false);
    if (!transaction) return;
    const error = await useTransactionsStore.getState().linkRefund(transaction.id, expenseId);
    if (error === null) {
      showSnackbar({ message: 'Linked as a refund' });
    } else {
      showDialog({
        title: 'Could not link this refund',
        message: error === 'missing' ? 'That item no longer exists.' : REFUND_LINK_ERROR_TEXT[error],
        icon: 'alert-circle-outline',
        actions: [{ label: 'OK', variant: 'primary' }],
      });
    }
  }

  async function handleUnlinkRefund(refundId: string) {
    const ok = await useTransactionsStore.getState().unlinkRefund(refundId);
    showSnackbar({ message: ok ? 'Refund unlinked — counts as income again' : 'Could not unlink' });
  }

  // R3b: manual "Mark as duplicate of…" — the picked row is kept, this one hidden.
  async function handleMarkDuplicate(keptId: string) {
    setDuplicatePickerOpen(false);
    if (!transaction) return;
    const duplicateId = transaction.id;
    const ok = await useTransactionsStore.getState().markDuplicate(keptId, duplicateId);
    if (!ok) {
      showSnackbar({ message: 'Could not mark as a duplicate' });
      return;
    }
    showSnackbar({ message: 'Marked as a duplicate' });
    navigation.goBack();
  }

  async function handleRestoreDuplicate(duplicateId: string) {
    const ok = await useTransactionsStore.getState().restoreDuplicate(duplicateId);
    showSnackbar({ message: ok ? 'Restored — not a duplicate' : 'Could not restore this item' });
  }

  // R3a: "Mark as transfer" — expense: pick "to"; income: pick "from".
  async function handleMarkAsTransfer(otherAccountId: string) {
    setTransferPickerOpen(false);
    if (!transaction) return;
    const ok = await useTransactionsStore.getState().markAsTransfer(transaction.id, otherAccountId);
    showSnackbar({ message: ok ? 'Marked as a transfer' : 'Could not mark as a transfer' });
  }

  // R3a: "Undo transfer" — both rows of the SMS pair go back exactly as they were.
  function handleUndoTransfer(transferId: string) {
    showDialog({
      title: 'Undo transfer?',
      message:
        'Both SMS items go back exactly as they were before you confirmed the transfer (status, type and category).',
      icon: 'undo-variant',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Undo transfer',
          variant: 'primary',
          onPress: async () => {
            const ok = await useTransactionsStore.getState().undoTransfer(transferId);
            showSnackbar({ message: ok ? 'Transfer undone' : 'Could not undo this transfer' });
          },
        },
      ],
    });
  }

  async function handleCategoryChange(categoryId: string) {
    setCategoryPickerOpen(false);
    if (!transaction || categoryId === transaction.categoryId) return;
    const before = transaction;
    await useTransactionsStore.getState().updateTransaction(before.id, { categoryId });
    promptRememberCategory({
      transactionId: before.id,
      merchantName: before.merchantName,
      previousCategoryId: before.categoryId,
      newCategoryId: categoryId,
    });
  }

  function handleDelete(transactionId: string) {
    const state = useTransactionsStore.getState();
    const current = state.transactions.find(t => t.id === transactionId);
    // R3b: a refund must never point at a deleted expense — unlink first.
    const linkedRefunds = refundsFor(state.transactions, transactionId);
    if (linkedRefunds.length > 0) {
      showDialog({
        title: 'Unlink refunds first',
        message: `This expense has ${linkedRefunds.length} linked refund${
          linkedRefunds.length === 1 ? '' : 's'
        }. Open ${linkedRefunds.length === 1 ? 'it' : 'each one'} and tap Unlink refund, then delete the expense.`,
        icon: 'link-variant',
        actions: [{ label: 'OK', variant: 'primary' }],
      });
      return;
    }
    const hiddenCount = hiddenDuplicatesOf(state.transactions, transactionId).length;
    const paired =
      current?.type === 'transfer' && findTransferTwin(state.transactions, transactionId) !== null;
    showDialog({
      title: current?.type === 'transfer' ? 'Delete transfer?' : 'Delete transaction?',
      message: paired
        ? 'This permanently removes the transfer and moves both balances back. The SMS credit it was paired with stays hidden — use Undo transfer instead to get both SMS items back.'
        : hiddenCount > 0
        ? 'This will permanently remove the record. Its hidden duplicate stays hidden — use Not a duplicate on it first if you want to keep that one instead.'
        : 'This will permanently remove the record.',
      icon: 'trash-can-outline',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: async () => {
            await deleteTransaction(transactionId);
            navigation.goBack();
          },
        },
      ],
    });
  }

  if (!transaction) {
    // Reached from Activity for a transaction that has since been deleted
    // (its audit history stays). Never crash — say so plainly.
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Icon name="arrow-left" size={22} color={colors.onSurface} onPress={() => navigation.goBack()} />
          <Text style={styles.headerTitle}>Transaction</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.missing}>
          <Icon name="trash-can-outline" size={32} color={colors.outline} />
          <Text style={styles.missingTitle}>Transaction deleted</Text>
          <Text style={styles.missingText}>
            This record was removed. Its history stays in Activity.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Icon name="arrow-left" size={22} color={colors.onSurface} onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Transaction</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <TransactionDetailContent
          transaction={transaction}
          variant="screen"
          hideActions
          onApprove={t => {
            approve(t.id);
            navigation.goBack();
          }}
          onReject={t => {
            reject(t.id);
            navigation.goBack();
          }}
          onEdit={t => navigation.navigate('EditTransaction', { transactionId: t.id })}
          onDelete={t => handleDelete(t.id)}
          onChangeCategory={() => setCategoryPickerOpen(true)}
          onOpenTransfer={id => navigation.push('TransactionDetail', { transactionId: id })}
          onOpenTransaction={id => navigation.push('TransactionDetail', { transactionId: id })}
        />
      </ScrollView>
      <View style={styles.footer}>
        <TransactionDetailActions
          transaction={transaction}
          onApprove={t => {
            approve(t.id);
            navigation.goBack();
          }}
          onReject={t => {
            reject(t.id);
            navigation.goBack();
          }}
          onEdit={t => navigation.navigate('EditTransaction', { transactionId: t.id })}
          onDelete={t => handleDelete(t.id)}
          onMarkAsTransfer={() => setTransferPickerOpen(true)}
          onUndoTransfer={t => handleUndoTransfer(t.id)}
          onLinkRefund={() => setRefundPickerOpen(true)}
          onUnlinkRefund={t => handleUnlinkRefund(t.id)}
          onMarkDuplicate={() => setDuplicatePickerOpen(true)}
          onRestoreDuplicate={t => handleRestoreDuplicate(t.id)}
        />
      </View>
      <TransferAccountPickerSheet
        visible={transferPickerOpen}
        onClose={() => setTransferPickerOpen(false)}
        excludeAccountId={transaction.accountId}
        direction={transaction.type === 'income' ? 'from' : 'to'}
        onSelect={handleMarkAsTransfer}
      />
      <RefundCandidateSheet
        visible={refundPickerOpen}
        onClose={() => setRefundPickerOpen(false)}
        refund={transaction}
        onSelect={handleLinkRefund}
      />
      <DuplicatePickerSheet
        visible={duplicatePickerOpen}
        onClose={() => setDuplicatePickerOpen(false)}
        transaction={transaction}
        onSelect={handleMarkDuplicate}
      />
      <CategoryPickerSheet
        visible={categoryPickerOpen}
        onClose={() => setCategoryPickerOpen(false)}
        type={transaction.type}
        selectedId={transaction.categoryId}
        onSelect={handleCategoryChange}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    padding: spacing.screen,
    paddingBottom: spacing.xl * 2,
  },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
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
    gap: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
  missingTitle: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  missingText: {
    ...typography.bodyLg,
    color: colors.outline,
    textAlign: 'center',
  },
});
