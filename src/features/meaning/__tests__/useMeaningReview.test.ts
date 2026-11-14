/**
 * R5e T5 — Review's "Money meaning" section lists open suggestions on
 * APPROVED income / expense rows only (pending rows show the card on the
 * Pending item). SYNTHETIC rows only.
 */
import { meaningReviewItems } from '../useMeaningReview';
import type { Transaction } from '../../../domain/transactions/transaction.types';
import type { MeaningSuggestion } from '../../../domain/meaning/meaning.types';

const T = '2026-11-05T10:00:00.000Z';
const row = (id: string, patch: Partial<Transaction>): Transaction =>
  ({ id, type: 'expense', status: 'approved', amountMinor: 100, occurredAt: T, accountId: 'bank', ...patch } as Transaction);
const s = (transactionId: string, resolvedAt: string | null = null): MeaningSuggestion => ({
  transactionId, kind: 'atm', targetAccountId: null, reason: 'missing', bankCanonical: 'sbi', counterpartyKey: '',
  createdAt: T, resolvedAt, resolution: resolvedAt ? 'expense' : null,
});

it('approved + open only, newest first; pending, closed, transfers and deleted rows are left out', () => {
  const rows = [
    row('a', {}),
    row('b', { occurredAt: '2026-11-06T10:00:00.000Z', type: 'income' }),
    row('c', { status: 'pending' }),
    row('d', {}),
    row('e', { type: 'transfer' }),
  ];
  const items = meaningReviewItems([s('a'), s('b'), s('c'), s('d', T), s('e'), s('gone')], rows);
  expect(items.map(i => i.transaction.id)).toEqual(['b', 'a']);
});
