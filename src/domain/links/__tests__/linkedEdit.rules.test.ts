import { Transaction } from '../../transactions/transaction.types';
import { linkRefundPatch } from '../../refunds/refund.rules';
import { canEditTransaction, linkedEditError } from '../linkedEdit.rules';
import { linkedEditMessage } from '../../../features/refunds/refundLabels';

function tx(id: string, patch: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amountMinor: 30000,
    currency: 'INR',
    merchantName: 'QA-Merchant-10',
    categoryId: 'cat-shopping',
    accountId: 'acc-bank',
    paymentMethod: 'other',
    occurredAt: '2026-10-20T10:00:00.000Z',
    detectedAt: '2026-10-20T10:00:00.000Z',
    approvedAt: '2026-10-20T10:00:00.000Z',
    note: null,
    sourceType: 'manual',
    sourceReferenceHash: null,
    sanitizedPreview: null,
    confidenceScore: null,
    parserVersion: null,
    bulkBatchId: null,
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...patch,
  };
}

const EXPENSE = tx('e1');
const REFUND = linkRefundPatch(
  tx('r1', { type: 'income', amountMinor: 10000, occurredAt: '2026-10-21T10:00:00.000Z' }),
  EXPENSE,
  '2026-10-22T00:00:00.000Z',
);
const OTHER_REFUND = linkRefundPatch(
  tx('r2', { type: 'income', amountMinor: 5000, occurredAt: '2026-10-21T11:00:00.000Z' }),
  EXPENSE,
  '2026-10-22T00:00:00.000Z',
);
const ROWS = [EXPENSE, REFUND, OTHER_REFUND];

describe('linkedEditError (R3b.1 F1)', () => {
  it('a linked refund cannot change its type away from income', () => {
    expect(linkedEditError(REFUND, { type: 'expense', amountMinor: 10000 }, ROWS)).toEqual({
      field: 'type',
      reason: 'refund-type',
    });
    expect(linkedEditError(REFUND, { type: 'income', amountMinor: 10000 }, ROWS)).toBeNull();
  });

  it('a linked refund cannot grow past what is still refundable (other refunds count)', () => {
    // 300 − 50 (other refund) = 250 left for r1.
    expect(linkedEditError(REFUND, { type: 'income', amountMinor: 25000 }, ROWS)).toBeNull();
    const over = linkedEditError(REFUND, { type: 'income', amountMinor: 25001 }, ROWS)!;
    expect(over).toEqual({ field: 'amount', reason: 'refund-over', limitMinor: 25000 });
    expect(linkedEditMessage(over)).toBe(
      'Refunds for this expense would be more than what was spent (₹250.00 left to refund).',
    );
  });

  it('an expense cannot drop below what is already refunded, nor change type', () => {
    expect(linkedEditError(EXPENSE, { type: 'expense', amountMinor: 15000 }, ROWS)).toBeNull();
    const below = linkedEditError(EXPENSE, { type: 'expense', amountMinor: 14999 }, ROWS)!;
    expect(below).toEqual({ field: 'amount', reason: 'expense-below-refunded', limitMinor: 15000 });
    expect(linkedEditMessage(below)).toBe('Cannot be less than the ₹150.00 already refunded.');
    expect(linkedEditMessage({ reason: 'expense-type' })).toBe(
      'This expense has linked refunds. Unlink them first.',
    );
    expect(linkedEditError(EXPENSE, { type: 'income', amountMinor: 30000 }, ROWS)?.field).toBe('type');
    expect(linkedEditError(EXPENSE, { type: 'transfer', amountMinor: 30000 }, ROWS)?.field).toBe('type');
  });

  it('rejected refunds do not hold the expense; unlinked rows are free to edit', () => {
    const rejected = { ...REFUND, status: 'rejected' as const };
    expect(linkedEditError(EXPENSE, { type: 'income', amountMinor: 1 }, [EXPENSE, rejected])).toBeNull();
    expect(linkedEditError(tx('plain'), { type: 'income', amountMinor: 1 }, [])).toBeNull();
  });

  it('hidden duplicates and transfer twins are never editable', () => {
    const dup = tx('d', { status: 'rejected', linkKind: 'duplicate', linkedTransactionId: 'e1' });
    const twin = tx('t', { type: 'income', status: 'rejected', linkKind: 'transfer_twin', linkedTransactionId: 'x' });
    expect(canEditTransaction(dup)).toBe(false);
    expect(canEditTransaction(twin)).toBe(false);
    expect(canEditTransaction(EXPENSE)).toBe(true);
    expect(canEditTransaction(REFUND)).toBe(true);
    expect(linkedEditError(dup, { type: 'expense', amountMinor: 30000 }, [dup])?.field).toBe('type');
  });
});
