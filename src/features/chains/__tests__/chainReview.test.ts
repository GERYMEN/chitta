/**
 * R5i (G3) — the Review "Linked by rules" join + D-d de-dupe policy (pure).
 * SYNTHETIC ids only.
 */
import { Transaction } from '../../../domain/transactions/transaction.types';
import { ChainSuggestion } from '../../sms-sync/rules/chaining';
import { chainReviewItems, chainRelationLabel, chainAcceptLabel } from '../chainReview';

function tx(p: Partial<Transaction> & { id: string }): Transaction {
  return {
    type: 'expense',
    status: 'pending',
    amountMinor: 50000,
    currency: 'INR',
    merchantName: 'QA Merchant',
    categoryId: 'cat-food',
    accountId: 'acc-1',
    paymentMethod: 'upi',
    occurredAt: '2026-11-21T10:00:00.000Z',
    detectedAt: '2026-11-21T10:00:00.000Z',
    approvedAt: null,
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: null,
    sanitizedPreview: null,
    confidenceScore: 90,
    parserVersion: null,
    bulkBatchId: null,
    createdAt: 'x',
    updatedAt: 'x',
    ...p,
  } as Transaction;
}

function sug(p: Partial<ChainSuggestion> & { kind: ChainSuggestion['kind']; childId: string }): ChainSuggestion {
  return {
    id: `s-${p.childId}`,
    parentId: 'parent' in p ? (p.parentId ?? null) : 'p',
    parentOverride: null,
    createdAt: 0,
    ...p,
  };
}

describe('chainReviewItems (D-d de-dupe)', () => {
  const child = tx({ id: 'c', type: 'income' });
  const parent = tx({ id: 'p', type: 'expense' });

  it('refund_link and incomplete always surface (no existing UI)', () => {
    const items = chainReviewItems(
      [sug({ kind: 'refund_link', childId: 'c', parentId: 'p' }), sug({ kind: 'incomplete', childId: 'c2', parentId: null })],
      [child, parent, tx({ id: 'c2' })],
    );
    expect(items.map(i => i.suggestion.kind).sort()).toEqual(['incomplete', 'refund_link']);
  });

  it('a duplicate / transfer_twin child already in another section is excluded', () => {
    const items = chainReviewItems(
      [sug({ kind: 'duplicate', childId: 'c', parentId: 'p' })],
      [child, parent],
      new Set(['c']),
    );
    expect(items).toHaveLength(0);
  });

  it('a transfer_twin child NOT in any section still surfaces', () => {
    const items = chainReviewItems(
      [sug({ kind: 'transfer_twin', childId: 'c', parentId: 'p' })],
      [child, parent],
      new Set(['someone-else']),
    );
    expect(items).toHaveLength(1);
  });

  it('drops a suggestion whose child was deleted / rejected', () => {
    const items = chainReviewItems(
      [sug({ kind: 'refund_link', childId: 'gone', parentId: 'p' })],
      [parent],
    );
    expect(items).toHaveLength(0);
  });

  it('drops a link suggestion whose parent no longer exists', () => {
    const items = chainReviewItems(
      [sug({ kind: 'refund_link', childId: 'c', parentId: 'missing' })],
      [child],
    );
    expect(items).toHaveLength(0);
  });

  it('labels', () => {
    expect(chainRelationLabel('incomplete')).toMatch(/waiting/i);
    expect(chainAcceptLabel('incomplete')).toBeNull();
    expect(chainAcceptLabel('refund_link')).toMatch(/refund/i);
  });
});
