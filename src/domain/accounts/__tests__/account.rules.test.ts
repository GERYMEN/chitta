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

describe('calculateBalance — R3a transfers', () => {
  const zero = { openingBalanceMinor: 0, balanceAnchorMinor: null, balanceAnchorAt: null };
  const bank = { ...zero, openingBalanceMinor: 1000000 };
  const wallet = { ...zero, openingBalanceMinor: 20000 };
  const t = (patch: Partial<Transaction>) => ({
    status: 'approved' as const,
    type: 'transfer' as const,
    amountMinor: 50000,
    accountId: 'acc-bank',
    transferAccountId: 'acc-wallet',
    occurredAt: '2026-10-05T00:00:00.000Z',
    ...patch,
  });

  it('subtracts on the from account and adds on the to account', () => {
    const rows = [t({})];
    expect(calculateBalance(bank, rows, 'acc-bank')).toBe(1000000 - 50000);
    expect(calculateBalance(wallet, rows, 'acc-wallet')).toBe(20000 + 50000);
    expect(calculateBalance(zero, rows, 'acc-other')).toBe(0);
  });

  it('the sum of two non-card balances (Home net worth) is unchanged by a transfer', () => {
    const before = calculateBalance(bank, [], 'acc-bank') + calculateBalance(wallet, [], 'acc-wallet');
    const rows = [t({}), t({ amountMinor: 1234, accountId: 'acc-wallet', transferAccountId: 'acc-bank' })];
    const after = calculateBalance(bank, rows, 'acc-bank') + calculateBalance(wallet, rows, 'acc-wallet');
    expect(after).toBe(before);
  });

  it('bank → credit card (bill payment) reduces what is owed on the card AND the bank balance', () => {
    const card = zero;
    const spend = txn({ type: 'expense', amountMinor: 300000, accountId: 'acc-card' });
    const owedBefore = -calculateBalance(card, [spend], 'acc-card');
    expect(owedBefore).toBe(300000);

    const payment = t({ amountMinor: 120000, accountId: 'acc-bank', transferAccountId: 'acc-card' });
    const rows = [spend, payment];
    const owedAfter = -calculateBalance(card, rows, 'acc-card');
    expect(owedAfter).toBe(180000);
    expect(calculateBalance(bank, rows, 'acc-bank')).toBe(1000000 - 120000);
  });

  it('pending / rejected transfers and transfers before the anchor never count', () => {
    const anchoredWallet = {
      openingBalanceMinor: 0,
      balanceAnchorMinor: 70000,
      balanceAnchorAt: '2026-10-10T00:00:00.000Z',
    };
    const rows = [
      t({ status: 'pending' }),
      t({ status: 'rejected' }),
      t({ occurredAt: '2026-10-09T00:00:00.000Z' }),
    ];
    expect(calculateBalance(anchoredWallet, rows, 'acc-wallet')).toBe(70000);
    expect(calculateBalance(bank, rows.slice(0, 2), 'acc-bank')).toBe(1000000);
  });

  it('a rejected transfer twin (income) never counts', () => {
    const twin = txn({
      type: 'income',
      status: 'rejected',
      amountMinor: 50000,
      accountId: 'acc-wallet',
    });
    expect(calculateBalance(wallet, [t({}), twin], 'acc-wallet')).toBe(20000 + 50000);
  });
});
