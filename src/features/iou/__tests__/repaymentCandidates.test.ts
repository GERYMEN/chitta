jest.mock('../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
import { repaymentCandidates } from '../components/RepaymentSheet';
import { IouShare } from '../../../domain/iou/iou.types';
import { Transaction } from '../../../domain/transactions/transaction.types';

const t = (id: string, patch: Partial<Transaction>): Transaction =>
  ({ id, type: 'income', status: 'approved', amountMinor: 100, occurredAt: '2026-10-01T00:00:00.000Z', merchantName: `QA-${id}`, linkKind: null, linkedTransactionId: null, transferAccountId: null, ...patch }) as Transaction;
const share = (patch: Partial<IouShare>): IouShare => ({
  id: 's', personId: 'p', direction: 'lent', sourceTransactionId: null, amountMinor: 500, note: null,
  createdAt: 'x', settledAt: null, repaymentTransactionId: null, ...patch,
});

describe('repaymentCandidates', () => {
  it('lent: unlinked approved credits, exact amount first then newest; excludes used / linked / pending / expenses', () => {
    const rows = [
      t('new', { occurredAt: '2026-10-09T00:00:00.000Z' }),
      t('exact', { amountMinor: 500, occurredAt: '2026-10-01T00:00:00.000Z' }),
      t('used', {}),
      t('linked', { linkKind: 'refund', linkedTransactionId: 'e' }),
      t('pending', { status: 'pending' }),
      t('exp', { type: 'expense' }),
    ];
    const out = repaymentCandidates(share({}), rows, [share({ id: 'other', repaymentTransactionId: 'used' })]);
    expect(out.map(x => x.id)).toEqual(['exact', 'new']);
  });
  it('borrowed: approved plain expenses only', () => {
    const rows = [t('e1', { type: 'expense' }), t('c1', {}), t('e2', { type: 'expense', linkKind: 'duplicate', linkedTransactionId: 'e1' })];
    expect(repaymentCandidates(share({ direction: 'borrowed' }), rows, []).map(x => x.id)).toEqual(['e1']);
  });
});
