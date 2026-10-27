import { Account } from '../account.types';
import { Transaction } from '../../transactions/transaction.types';
import {
  accountDisplayLabel,
  activeAccounts,
  calculateBalance,
  deletedAccounts,
  isDeletedAccount,
} from '../account.rules';

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'acc-1',
  name: 'HDFC',
  type: 'bank',
  lastFour: '1859',
  openingBalanceMinor: 100000,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

type Tx = Pick<Transaction, 'status' | 'type' | 'amountMinor' | 'accountId' | 'occurredAt'>;
const tx = (accountId: string, amountMinor: number): Tx => ({
  status: 'approved',
  type: 'expense',
  amountMinor,
  accountId,
  occurredAt: '2026-10-10T00:00:00.000Z',
});

describe('D10 account labels', () => {
  it('labels a deleted account with last four and name', () => {
    expect(accountDisplayLabel(account({ deletedAt: '2026-10-20T00:00:00.000Z' }))).toBe(
      'Deleted account ••1859 (HDFC)',
    );
  });

  it('labels a deleted account without last four by name only', () => {
    expect(
      accountDisplayLabel(account({ name: 'Cash', lastFour: null, deletedAt: '2026-10-20T00:00:00.000Z' })),
    ).toBe('Deleted account (Cash)');
  });

  it('labels active accounts as before', () => {
    expect(accountDisplayLabel(account())).toBe('HDFC ••••1859');
    expect(accountDisplayLabel(account({ lastFour: null, name: 'Wallet' }))).toBe('Wallet');
  });

  it('labels a missing account as Unknown', () => {
    expect(accountDisplayLabel(undefined)).toBe('Unknown');
    expect(accountDisplayLabel(null)).toBe('Unknown');
  });
});

describe('D10 active / deleted filtering', () => {
  const live = account({ id: 'a' });
  const gone = account({ id: 'b', deletedAt: '2026-10-20T00:00:00.000Z' });

  it('splits accounts by deletedAt', () => {
    expect(isDeletedAccount(gone)).toBe(true);
    expect(isDeletedAccount(live)).toBe(false);
    expect(activeAccounts([live, gone]).map(a => a.id)).toEqual(['a']);
    expect(deletedAccounts([live, gone]).map(a => a.id)).toEqual(['b']);
  });

  it('total balance over active accounts excludes the deleted one, transactions untouched', () => {
    const transactions = [tx('a', 10000), tx('b', 10000)];
    const total = (list: Account[]) =>
      list.reduce((sum, a) => sum + calculateBalance(a, transactions, a.id), 0);

    expect(total([live, gone])).toBe(180000);
    expect(total(activeAccounts([live, gone]))).toBe(90000);
    // The deleted account's spending is still in the transaction list.
    expect(transactions.filter(t => t.accountId === 'b')).toHaveLength(1);
  });
});
