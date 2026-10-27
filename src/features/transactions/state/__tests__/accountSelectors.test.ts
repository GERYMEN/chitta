import { Account } from '../../../../domain/accounts/account.types';
import { selectActiveAccounts, selectDeletedAccounts } from '../transactionsStore';

const account = (id: string, deletedAt: string | null): Account => ({
  id,
  name: id,
  type: 'bank',
  lastFour: null,
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('account selectors (D10)', () => {
  const state = { accounts: [account('a', null), account('b', '2026-10-20T00:00:00.000Z')] };

  it('selectActiveAccounts drops soft-deleted accounts', () => {
    expect(selectActiveAccounts(state).map(a => a.id)).toEqual(['a']);
  });

  it('selectDeletedAccounts returns only soft-deleted accounts', () => {
    expect(selectDeletedAccounts(state).map(a => a.id)).toEqual(['b']);
  });
});
