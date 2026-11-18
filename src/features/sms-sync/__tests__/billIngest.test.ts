import { billInputFromSms, matchBillAccount } from '../billIngest';
import { readSmsWithReader } from '../parser/readSms';
import { Account } from '../../../domain/accounts/account.types';

function account(p: Partial<Account>): Account {
  return {
    id: p.id ?? 'acc-1',
    name: p.name ?? 'QA Bank',
    type: p.type ?? 'bank',
    lastFour: p.lastFour ?? null,
    openingBalanceMinor: 0,
    currency: 'INR',
    isActive: true,
    balanceAnchorMinor: null,
    balanceAnchorAt: null,
    deletedAt: null,
    creditLimitMinor: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const MSG = { address: 'AD-HDFCBK-S', body: 'x', date: 1763000000000 };

describe('billInputFromSms (D-d)', () => {
  it('a statement non-transaction becomes a card_statement bill, mapped to the card account', () => {
    const accounts = [account({ id: 'card', name: 'HDFC Credit Card', type: 'credit_card', lastFour: '9999' })];
    const input = billInputFromSms(
      {
        institution: 'hdfc',
        nonTransaction: {
          label: 'statement',
          amountMinor: 1200000,
          minDueMinor: 60000,
          lastFour: '9999',
          dueDate: '2026-11-20T06:30:00.000Z',
          statementDate: '2026-11-01T06:30:00.000Z',
          availableLimitMinor: null,
        },
      },
      MSG,
      'salt',
      accounts,
    );
    expect(input).not.toBeNull();
    expect(input!.kind).toBe('card_statement');
    expect(input!.accountId).toBe('card');
    expect(input!.amountDueMinor).toBe(1200000);
    expect(input!.minDueMinor).toBe(60000);
    expect(input!.dueDate).toBe('2026-11-20T06:30:00.000Z');
    expect(input!.sourceHash).toMatch(/^[0-9a-f]{32}$/);
    // payee = the matched account's name (a known display name, never SMS text)
    expect(input!.payee).toBe('HDFC Credit Card');
  });

  it('a bill_due with no matching account maps to account_id null + issuer payee + biller kind', () => {
    const input = billInputFromSms(
      {
        institution: 'hdfc',
        nonTransaction: { label: 'bill_due', amountMinor: 50000, minDueMinor: null, lastFour: null, dueDate: '2026-11-22T06:30:00.000Z' },
      },
      MSG,
      'salt',
      [],
    );
    expect(input!.accountId).toBeNull();
    expect(input!.kind).toBe('biller');
    expect(input!.payee).not.toBe('');
  });

  it('a pay_later account makes a bill_due a pay_later bill', () => {
    const accounts = [account({ id: 'pl', name: 'HDFC Pay Later', type: 'pay_later', lastFour: '1234' })];
    const input = billInputFromSms(
      {
        institution: 'hdfc',
        nonTransaction: { label: 'bill_due', amountMinor: 50000, minDueMinor: null, lastFour: '1234', dueDate: null },
      },
      MSG,
      'salt',
      accounts,
    );
    expect(input!.kind).toBe('pay_later');
    expect(input!.accountId).toBe('pl');
  });

  it('a balance_info / otp is NOT a bill', () => {
    expect(
      billInputFromSms(
        { institution: 'hdfc', nonTransaction: { label: 'balance_info', amountMinor: 999, minDueMinor: null, lastFour: null } },
        MSG,
        'salt',
        [],
      ),
    ).toBeNull();
    expect(
      billInputFromSms({ institution: 'hdfc', nonTransaction: null }, MSG, 'salt', []),
    ).toBeNull();
  });

  it('a bill with no amount is skipped', () => {
    expect(
      billInputFromSms(
        { institution: 'hdfc', nonTransaction: { label: 'statement', amountMinor: null, minDueMinor: null, lastFour: '9999' } },
        MSG,
        'salt',
        [],
      ),
    ).toBeNull();
  });
});

describe('matchBillAccount', () => {
  it('prefers a card account for a statement', () => {
    const accounts = [
      account({ id: 'bank', name: 'HDFC Bank', type: 'bank', lastFour: '9999' }),
      account({ id: 'card', name: 'HDFC Card', type: 'credit_card', lastFour: '9999' }),
    ];
    expect(matchBillAccount({ lastFour: '9999', label: 'statement' }, 'hdfc', accounts)?.id).toBe('card');
  });
});

describe('reader extracts a bill due date (T1)', () => {
  it('a statement SMS yields a nonTransaction with a 2026-11-20 due date', () => {
    const read = readSmsWithReader({
      id: 'sms-bill-1',
      address: 'AD-HDFCBK-S',
      body: 'QA Bank card statement: Total amount due Rs 5000.00, Min amount due Rs 500.00, Due by 20-11-2026',
      date: 1763000000000,
    });
    expect(read.nonTransaction).not.toBeNull();
    expect(read.nonTransaction!.dueDate).toMatch(/^2026-11-20/);
  });
});
