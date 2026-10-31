import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { showSnackbar } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { TransferPair } from '../../../domain/transfers/transfer.rules';
import { DuplicatePair } from '../../../domain/duplicates/duplicate.rules';
import { useTransferPairs } from '../../transfers/useTransferPairs';
import { useDuplicatePairs } from '../../duplicates/useDuplicatePairs';
import { TransferPairCard } from '../../transfers/components/TransferPairCard';
import { DuplicatePairCard } from '../../duplicates/components/DuplicatePairCard';

/**
 * R3a "Looks like a transfer" + R3b "Possible duplicates" — shared by Pending
 * (top of the list) and the Review screen (Home "N to review" card). Pairs of
 * pending OR approved rows; `accountId` narrows both to pairs on that account.
 */
export function ReviewSections({
  accountId = null,
  emptyText,
}: {
  accountId?: string | null;
  /** Shown when there is nothing to review (omit to render nothing). */
  emptyText?: string;
}) {
  const accounts = useTransactionsStore(state => state.accounts);
  const allTransferPairs = useTransferPairs();
  const allDuplicatePairs = useDuplicatePairs();
  const [busy, setBusy] = useState(false);

  const transferPairs = useMemo(
    () =>
      accountId
        ? allTransferPairs.filter(
            p => p.debit.accountId === accountId || p.credit.accountId === accountId,
          )
        : allTransferPairs,
    [allTransferPairs, accountId],
  );
  const duplicatePairs = useMemo(
    () => (accountId ? allDuplicatePairs.filter(p => p.first.accountId === accountId) : allDuplicatePairs),
    [allDuplicatePairs, accountId],
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  const confirmTransfer = (pair: TransferPair) =>
    run(async () => {
      const ok = await useTransactionsStore
        .getState()
        .confirmTransferPair(pair.debit.id, pair.credit.id);
      showSnackbar({ message: ok ? 'Recorded as a transfer' : 'This pair changed — not recorded' });
    });

  const dismissTransfer = (pair: TransferPair) =>
    run(async () => {
      await useTransactionsStore.getState().dismissTransferPair(pair.debit.id, pair.credit.id);
      showSnackbar({ message: 'Kept as separate items' });
    });

  const markDuplicate = (keptId: string, duplicateId: string) =>
    run(async () => {
      const ok = await useTransactionsStore.getState().markDuplicate(keptId, duplicateId);
      showSnackbar(
        ok
          ? {
              message: 'Marked as a duplicate',
              actionLabel: 'Undo',
              onAction: async () => {
                await useTransactionsStore.getState().restoreDuplicate(duplicateId);
              },
            }
          : { message: 'These items changed — nothing hidden' },
      );
    });

  const dismissDuplicate = (pair: DuplicatePair) =>
    run(async () => {
      await useTransactionsStore.getState().dismissDuplicatePair(pair.first.id, pair.second.id);
      showSnackbar({ message: 'Kept both items' });
    });

  if (transferPairs.length === 0 && duplicatePairs.length === 0) {
    return emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null;
  }

  return (
    <View>
      {transferPairs.length > 0 ? (
        <View style={styles.section} testID="transfer-pairs-section">
          <Text style={styles.header} testID="transfer-pairs-header">
            Looks like a transfer · {transferPairs.length}
          </Text>
          <Text style={styles.hint}>
            Money out of one of your accounts and the same amount into another. A transfer moves
            both balances and is never counted as income or expense.
          </Text>
          {transferPairs.map(pair => (
            <TransferPairCard
              key={`${pair.debit.id}|${pair.credit.id}`}
              pair={pair}
              accounts={accounts}
              busy={busy}
              onConfirm={confirmTransfer}
              onDismiss={dismissTransfer}
            />
          ))}
        </View>
      ) : null}
      {duplicatePairs.length > 0 ? (
        <View style={styles.section} testID="duplicate-pairs-section">
          <Text style={styles.header} testID="duplicate-pairs-header">
            Possible duplicates · {duplicatePairs.length}
          </Text>
          <Text style={styles.hint}>
            The same amount on the same account within a few minutes. Keep one — the other stops
            counting anywhere.
          </Text>
          {duplicatePairs.map(pair => (
            <DuplicatePairCard
              key={`${pair.first.id}|${pair.second.id}`}
              pair={pair}
              accounts={accounts}
              busy={busy}
              onMark={markDuplicate}
              onDismiss={dismissDuplicate}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  header: {
    ...typography.labelLg,
    color: colors.onSurfaceVariant,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  hint: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  empty: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
    padding: spacing.xl,
  },
});
