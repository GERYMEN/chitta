import { calculateBalance } from '../account.rules';
import { Transaction } from '../../transactions/transaction.types';
import { Account } from '../account.types';

const account = {
  openingBalanceMinor: 100000,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
};

function txn(overrides: Partial<Transaction>): Pick<
  Transaction,
  'status' | 'type' | 'amountMinor' | 'accountId' | 'occurredAt'
> {
  return {
    status: 'approved',
    type: 'expense',
    amountMinor: 0,
    accountId: 'acc-1',
    occurredAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('calculateBalance', () => {
  it('starts from the opening balance with no transactions', () => {
    expect(calculateBalance(account, [], 'acc-1')).toBe(100000);
  });

  it('adds approved income and subtracts approved expense', () => {
    const transactions = [
      txn({ type: 'income', amountMinor: 50000 }),
      txn({ type: 'expense', amountMinor: 20000 }),
    ];
    expect(calculateBalance(account, transactions, 'acc-1')).toBe(130000);
  });

  it('ignores pending and rejected transactions', () => {
    const transactions = [
      txn({ type: 'income', amountMinor: 50000, status: 'pending' }),
      txn({ type: 'expense', amountMinor: 20000, status: 'rejected' }),
    ];
    expect(calculateBalance(account, transactions, 'acc-1')).toBe(100000);
  });

  it('ignores transactions belonging to a different account', () => {
    const transactions = [txn({ type: 'income', amountMinor: 50000, accountId: 'acc-2' })];
    expect(calculateBalance(account, transactions, 'acc-1')).toBe(100000);
  });

  it('matches the old formula byte-for-byte when no anchor is set', () => {
    const transactions = [
      txn({ type: 'income', amountMinor: 50000 }),
      txn({ type: 'expense', amountMinor: 20000 }),
      txn({ type: 'expense', amountMinor: 12345, occurredAt: '2025-01-01T00:00:00.000Z' }),
      txn({ type: 'income', amountMinor: 1, status: 'pending' }),
      txn({ type: 'expense', amountMinor: 99999, accountId: 'acc-2' }),
    ];
    const openingBalance = account.openingBalanceMinor;
    const expected = transactions
      .filter(t => t.accountId === 'acc-1' && t.status === 'approved')
      .reduce((sum, t) => (t.type === 'income' ? sum + t.amountMinor : sum - t.amountMinor), openingBalance);
    expect(calculateBalance(account, transactions, 'acc-1')).toBe(expected);
    expect(calculateBalance(account, transactions, 'acc-1')).toBe(117655);
  });

  it('uses the anchor value as the base when an anchor is set', () => {
    const anchored: Pick<Account, 'openingBalanceMinor' | 'balanceAnchorMinor' | 'balanceAnchorAt'> = {
      openingBalanceMinor: 100000,
      balanceAnchorMinor: 500000,
      balanceAnchorAt: '2026-10-01T00:00:00.000Z',
    };
    expect(calculateBalance(anchored, [], 'acc-1')).toBe(500000);
  });

  it('excludes transactions dated exactly before the anchor', () => {
    const anchored: Pick<Account, 'openingBalanceMinor' | 'balanceAnchorMinor' | 'balanceAnchorAt'> = {
      openingBalanceMinor: 100000,
      balanceAnchorMinor: 500000,
      balanceAnchorAt: '2026-10-01T00:00:00.000Z',
    };
    const before = txn({
      type: 'expense',
      amountMinor: 12345,
      occurredAt: '2026-09-30T23:59:59.999Z',
    });
    expect(calculateBalance(anchored, [before], 'acc-1')).toBe(500000);
  });

  it('excludes a transaction dated exactly at the anchor (strictly after)', () => {
    const anchored: Pick<Account, 'openingBalanceMinor' | 'balanceAnchorMinor' | 'balanceAnchorAt'> = {
      openingBalanceMinor: 100000,
      balanceAnchorMinor: 500000,
      balanceAnchorAt: '2026-10-01T00:00:00.000Z',
    };
    const at = txn({
      type: 'expense',
      amountMinor: 12345,
      occurredAt: '2026-10-01T00:00:00.000Z',
    });
    expect(calculateBalance(anchored, [at], 'acc-1')).toBe(500000);
  });

  it('changes the balance by the exact paise amount for a transaction after the anchor', () => {
    const anchored: Pick<Account, 'openingBalanceMinor' | 'balanceAnchorMinor' | 'balanceAnchorAt'> = {
      openingBalanceMinor: 100000,
      balanceAnchorMinor: 500000,
      balanceAnchorAt: '2026-10-01T00:00:00.000Z',
    };
    const after = txn({
      type: 'expense',
      amountMinor: 12345,
      occurredAt: '2026-10-02T00:00:00.000Z',
    });
    expect(calculateBalance(anchored, [after], 'acc-1')).toBe(487655);
  });

  it('still ignores pending/rejected and other-account transactions when anchored', () => {
    const anchored: Pick<Account, 'openingBalanceMinor' | 'balanceAnchorMinor' | 'balanceAnchorAt'> = {
      openingBalanceMinor: 100000,
      balanceAnchorMinor: 500000,
      balanceAnchorAt: '2026-10-01T00:00:00.000Z',
    };
    const transactions = [
      txn({ type: 'income', amountMinor: 99999, occurredAt: '2026-10-02T00:00:00.000Z', status: 'pending' }),
      txn({ type: 'expense', amountMinor: 99999, occurredAt: '2026-10-02T00:00:00.000Z', status: 'rejected' }),
      txn({ type: 'income', amountMinor: 99999, occurredAt: '2026-10-02T00:00:00.000Z', accountId: 'acc-2' }),
    ];
    expect(calculateBalance(anchored, transactions, 'acc-1')).toBe(500000);
  });
});
