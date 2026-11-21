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
import { redactText, useRedacted } from '../../../shared/privacy/redaction';
import { AmountText } from '../../../shared/ui/AmountText';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { useMeaningReviewItems } from '../../meaning/useMeaningReview';
import { MeaningCard } from '../../meaning/components/MeaningCard';
import { useChainSuggestions } from '../../sms-sync/rules/chaining';
import { ChainReviewItem, chainReviewItems } from '../../chains/chainReview';
import { ChainSuggestionCard } from '../../chains/components/ChainSuggestionCard';

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
  const transactions = useTransactionsStore(state => state.transactions);
  useRedacted(); // R4c: pair cards re-render masked in the feedback screenshot
  const allTransferPairs = useTransferPairs();
  const allDuplicatePairs = useDuplicatePairs();
  // R5i (G3): persisted chain suggestions — the "Linked by rules" section.
  const chainSuggestions = useChainSuggestions(state => state.suggestions);
  // R5e T5: money meanings found by a re-scan on APPROVED rows.
  const allMeaningItems = useMeaningReviewItems();
  const meaningItems = useMemo(
    () =>
      accountId
        ? allMeaningItems.filter(item => item.transaction.accountId === accountId)
        : allMeaningItems,
    [allMeaningItems, accountId],
  );
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
    () =>
      accountId
        ? allDuplicatePairs.filter(
            // R5d: a same-reference pair may span two accounts.
            p => p.first.accountId === accountId || p.second.accountId === accountId,
          )
        : allDuplicatePairs,
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

  // D-d: a chain child already surfaced by the transfer / duplicate sections
  // must NOT appear twice. Exclude every id in those pairs.
  const chainItems = useMemo(() => {
    const exclude = new Set<string>();
    for (const p of transferPairs) {
      exclude.add(p.debit.id);
      exclude.add(p.credit.id);
    }
    for (const p of duplicatePairs) {
      exclude.add(p.first.id);
      exclude.add(p.second.id);
    }
    const items = chainReviewItems(chainSuggestions, transactions, exclude);
    return accountId ? items.filter(i => i.child.accountId === accountId) : items;
  }, [chainSuggestions, transactions, transferPairs, duplicatePairs, accountId]);

  const acceptChain = (item: ChainReviewItem) =>
    run(async () => {
      const { suggestion, child, parent } = item;
      const store = useTransactionsStore.getState();
      let ok = false;
      if (suggestion.kind === 'refund_link' && parent) {
        ok = (await store.linkRefund(child.id, parent.id)) === null;
      } else if (suggestion.kind === 'transfer_twin' && parent) {
        const debit = child.type === 'expense' ? child : parent;
        const credit = child.type === 'income' ? child : parent;
        ok = await store.confirmTransferPair(debit.id, credit.id);
      } else if (suggestion.kind === 'duplicate' && parent) {
        ok = await store.markDuplicate(parent.id, child.id);
      }
      if (ok) {
        await useChainSuggestions.getState().accept(child.id);
        showSnackbar({ message: 'Linked by rules' });
      } else {
        // D-e: a stale / superseded pair — match the existing copy.
        await useChainSuggestions.getState().supersede(child.id);
        showSnackbar({ message: 'This pair changed — not recorded' });
      }
    });

  const dismissChain = (item: ChainReviewItem) =>
    run(async () => {
      const removed = await useChainSuggestions.getState().dismiss(item.child.id);
      showSnackbar({
        message: 'Kept as separate items',
        actionLabel: 'Undo',
        onAction: async () => {
          if (removed) await useChainSuggestions.getState().reopen(removed);
        },
      });
    });

  if (
    transferPairs.length === 0 &&
    duplicatePairs.length === 0 &&
    meaningItems.length === 0 &&
    chainItems.length === 0
  ) {
    return emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null;
  }

  return (
    <View>
      {meaningItems.length > 0 ? (
        <View style={styles.section} testID="meaning-section">
          <Text style={styles.header} testID="meaning-header">
            Money meaning · {meaningItems.length}
          </Text>
          <Text style={styles.hint}>
            Recorded as spending or income, but the money only moved between your own accounts.
            Nothing changes until you confirm.
          </Text>
          {meaningItems.map(({ suggestion, transaction }) => (
            <View key={transaction.id} style={styles.meaningItem}>
              <View style={styles.meaningRow}>
                <Text style={styles.meaningTitle} numberOfLines={1}>
                  {redactText(transaction.merchantName)} · {formatTransactionTimestamp(transaction.occurredAt)}
                </Text>
                <AmountText amountMinor={transaction.amountMinor} type={transaction.type} variant="labelLg" />
              </View>
              <MeaningCard suggestion={suggestion} transaction={transaction} />
            </View>
          ))}
        </View>
      ) : null}
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
            The same amount on the same account within a few minutes, or the same payment
            reference. Keep one — the other stops counting anywhere.
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
      {chainItems.length > 0 ? (
        <View style={styles.section} testID="chain-section">
          <Text style={styles.header} testID="chain-header">
            Linked by rules · {chainItems.length}
          </Text>
          <Text style={styles.hint}>
            Our rules matched these to another message. Nothing changes until you accept.
          </Text>
          {chainItems.map(item => (
            <ChainSuggestionCard
              key={item.suggestion.id}
              item={item}
              accounts={accounts}
              busy={busy}
              onAccept={acceptChain}
              onDismiss={dismissChain}
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
  meaningItem: {
    gap: spacing.xs,
  },
  meaningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  meaningTitle: {
    ...typography.labelLg,
    color: colors.onSurface,
    flex: 1,
  },
  empty: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
    padding: spacing.xl,
  },
});
