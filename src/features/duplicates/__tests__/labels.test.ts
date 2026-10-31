import {
  duplicatePairTitle,
  duplicateRowStatus,
  hiddenDuplicatesLabel,
  toReviewLabel,
} from '../duplicateLabels';
import {
  leftToRefundLabel,
  refundedLabel,
  refundRowLine,
} from '../../refunds/refundLabels';

const ACCOUNTS = [{ id: 'acc-bank', name: 'QA Delete Bank 9999', lastFour: '9999', deletedAt: null }];

describe('R3b labels', () => {
  it('duplicate + review strings', () => {
    expect(duplicatePairTitle({ amountMinor: 5000, accountId: 'acc-bank', type: 'expense' }, ACCOUNTS)).toBe(
      '₹50.00 out twice on QA Delete Bank 9999 ••••9999',
    );
    expect(duplicateRowStatus({ status: 'approved' })).toBe('Approved');
    expect(duplicateRowStatus({ status: 'pending' })).toBe('Pending');
    expect(toReviewLabel(1)).toBe('1 to review');
    expect(toReviewLabel(3)).toBe('3 to review');
    expect(hiddenDuplicatesLabel(1)).toBe('1 duplicate hidden');
    expect(hiddenDuplicatesLabel(2)).toBe('2 duplicates hidden');
  });

  it('refund strings', () => {
    expect(leftToRefundLabel(20000)).toBe('₹200.00 left to refund');
    expect(refundedLabel(10000)).toBe('Refunded ₹100.00');
    expect(refundRowLine({ amountMinor: 10000, occurredAt: '2026-10-01T10:00:00.000Z' })).toMatch(/^₹100\.00 · /);
  });
});
