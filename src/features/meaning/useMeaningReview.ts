import { useMemo } from 'react';
import { useTransactionsStore } from '../transactions/state/transactionsStore';
import type { Transaction } from '../../domain/transactions/transaction.types';
import type { MeaningSuggestion } from '../../domain/meaning/meaning.types';

export interface MeaningReviewItem {
  suggestion: MeaningSuggestion;
  transaction: Transaction;
}

/**
 * R5e T5: open meaning suggestions on APPROVED rows (history found by a
 * re-scan) — listed in Review's "Money meaning" section. Pending rows show
 * their meaning card on the Pending item instead. Pure helper + memo hook.
 */
export function meaningReviewItems(
  suggestions: ReadonlyArray<MeaningSuggestion>,
  transactions: ReadonlyArray<Transaction>,
): MeaningReviewItem[] {
  const byId = new Map(transactions.map(t => [t.id, t]));
  const items: MeaningReviewItem[] = [];
  for (const suggestion of suggestions) {
    if (suggestion.resolvedAt != null) continue;
    const transaction = byId.get(suggestion.transactionId);
    if (!transaction || transaction.status !== 'approved') continue;
    if (transaction.type !== 'income' && transaction.type !== 'expense') continue;
    items.push({ suggestion, transaction });
  }
  return items.sort((a, b) => Date.parse(b.transaction.occurredAt) - Date.parse(a.transaction.occurredAt));
}

export function useMeaningReviewItems(): MeaningReviewItem[] {
  const suggestions = useTransactionsStore(state => state.meaningSuggestions);
  const transactions = useTransactionsStore(state => state.transactions);
  return useMemo(() => meaningReviewItems(suggestions, transactions), [suggestions, transactions]);
}
