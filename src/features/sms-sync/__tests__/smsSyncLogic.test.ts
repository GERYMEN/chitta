import { Account } from '../../../domain/accounts/account.types';
import { Category } from '../../../domain/categories/category.types';
import { ParsedSmsTransaction } from '../smsParser';
import {
  filterNewCandidates,
  groupUnmatchedIntoSuggestions,
  isOwnedByDeletedAccount,
  partitionCandidates,
  resolveAccountIdForSms,
  resolveCategoryIdForSms,
} from '../smsSyncLogic';

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'acc-1',
  name: 'Test',
  type: 'bank',
  lastFour: null,
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const category = (overrides: Partial<Category> = {}): Category => ({
  id: 'cat-x',
  name: 'X',
  parentId: null,
  type: 'expense',
  icon: 'help',
  isSystem: true,
  ...overrides,
});

const parsed = (
  hash: string,
  overrides: Partial<ParsedSmsTransaction> = {},
): ParsedSmsTransaction => ({
  type: 'expense',
  amountMinor: 25000,
  merchantName: 'Amazon',
  occurredAt: '2026-10-01T00:00:00.000Z',
  confidenceScore: 0.9,
  sanitizedPreview: 'Debited ₹250 — Amazon',
  sourceReferenceHash: hash,
  bankName: 'Unknown Bank',
  bankCanonical: 'unknown',
  accountKind: 'upi',
  lastFour: null,
  ...overrides,
});

describe('resolveAccountIdForSms', () => {
  it('matches an account only when both type and lastFour agree', () => {
    const accounts = [
      account({ id: 'acc-a', type: 'bank', lastFour: '5678' }),
      account({ id: 'acc-b', type: 'bank', lastFour: '1234' }),
    ];
    expect(
      resolveAccountIdForSms(accounts, { accountKind: 'bank', lastFour: '1234' }),
    ).toBe('acc-b');
  });

  it('returns null when lastFour matches but type differs (credit card vs bank)', () => {
    const accounts = [account({ id: 'acc-a', type: 'credit_card', lastFour: '1234' })];
    expect(
      resolveAccountIdForSms(accounts, { accountKind: 'bank', lastFour: '1234' }),
    ).toBeNull();
  });

  it('returns null when type matches but lastFour differs', () => {
    const accounts = [account({ id: 'acc-a', type: 'bank', lastFour: '9999' })];
    expect(
      resolveAccountIdForSms(accounts, { accountKind: 'bank', lastFour: '1234' }),
    ).toBeNull();
  });

  it('returns null (never the first account) when nothing matches', () => {
    const accounts = [
      account({ id: 'acc-a', type: 'bank', lastFour: '9999' }),
      account({ id: 'acc-b', type: 'bank', lastFour: '8888' }),
    ];
    expect(
      resolveAccountIdForSms(accounts, { accountKind: 'bank', lastFour: '1234' }),
    ).toBeNull();
  });

  it('returns null when the candidate has no extractable lastFour', () => {
    const accounts = [account({ id: 'acc-a', type: 'bank', lastFour: '1234' })];
    expect(
      resolveAccountIdForSms(accounts, { accountKind: 'bank', lastFour: null }),
    ).toBeNull();
  });

  it('returns null when there are no accounts', () => {
    expect(
      resolveAccountIdForSms([], { accountKind: 'bank', lastFour: '1234' }),
    ).toBeNull();
  });
});

describe('groupUnmatchedIntoSuggestions', () => {
  it('groups by accountKind:bankName:lastFour and counts per group', () => {
    const unmatched = [
      parsed('h1', { accountKind: 'bank', bankName: 'HDFC', lastFour: '7302' }),
      parsed('h2', { accountKind: 'bank', bankName: 'HDFC', lastFour: '7302' }),
      parsed('h3', { accountKind: 'credit_card', bankName: 'HDFC', lastFour: '8123' }),
    ];
    expect(groupUnmatchedIntoSuggestions(unmatched)).toEqual([
      { bankName: 'HDFC', accountKind: 'bank', lastFour: '7302', messageCount: 2 },
      { bankName: 'HDFC', accountKind: 'credit_card', lastFour: '8123', messageCount: 1 },
    ]);
  });

  it('treats a missing lastFour as its own "unknown" bucket', () => {
    const unmatched = [
      parsed('h1', { accountKind: 'upi', bankName: 'Unknown Bank', lastFour: null }),
      parsed('h2', { accountKind: 'upi', bankName: 'Unknown Bank', lastFour: null }),
    ];
    expect(groupUnmatchedIntoSuggestions(unmatched)).toEqual([
      { bankName: 'Unknown Bank', accountKind: 'upi', lastFour: null, messageCount: 2 },
    ]);
  });

  it('sorts by messageCount descending', () => {
    const unmatched = [
      parsed('h1', { accountKind: 'bank', bankName: 'SBI', lastFour: '1111' }),
      parsed('h2', { accountKind: 'bank', bankName: 'HDFC', lastFour: '2222' }),
      parsed('h3', { accountKind: 'bank', bankName: 'HDFC', lastFour: '2222' }),
      parsed('h4', { accountKind: 'bank', bankName: 'HDFC', lastFour: '2222' }),
    ];
    const result = groupUnmatchedIntoSuggestions(unmatched);
    expect(result.map(s => `${s.bankName}:${s.lastFour}`)).toEqual([
      'HDFC:2222',
      'SBI:1111',
    ]);
  });

  it('returns an empty array for no unmatched candidates', () => {
    expect(groupUnmatchedIntoSuggestions([])).toEqual([]);
  });
});

describe('resolveCategoryIdForSms', () => {
  const categories = [
    category({ id: 'cat-shopping', name: 'Shopping', type: 'expense' }),
    category({ id: 'cat-salary', name: 'Salary & Wages', type: 'income' }),
  ];

  it('maps expense -> Shopping category', () => {
    expect(resolveCategoryIdForSms(categories, 'expense')).toBe('cat-shopping');
  });

  it('maps income -> Salary & Wages category', () => {
    expect(resolveCategoryIdForSms(categories, 'income')).toBe('cat-salary');
  });

  it('falls back to the first category of the matching type when the named one is absent', () => {
    expect(resolveCategoryIdForSms([category({ id: 'cat-food', name: 'Food', type: 'expense' })], 'expense')).toBe('cat-food');
  });

  it('returns null when no matching category exists', () => {
    expect(resolveCategoryIdForSms([category({ id: 'cat-salary', name: 'Salary & Wages', type: 'income' })], 'expense')).toBeNull();
  });
});

describe('filterNewCandidates', () => {
  it('drops candidates whose hash already exists', () => {
    const candidates = [parsed('sms-1-1'), parsed('sms-2-2'), parsed('sms-3-3')];
    const existing = new Set(['sms-2-2']);
    expect(filterNewCandidates(candidates, existing).map(c => c.sourceReferenceHash)).toEqual([
      'sms-1-1',
      'sms-3-3',
    ]);
  });

  it('returns all candidates when nothing exists yet', () => {
    const candidates = [parsed('sms-1-1'), parsed('sms-2-2')];
    expect(filterNewCandidates(candidates, new Set())).toHaveLength(2);
  });
});

describe('D10 sync drop for soft-deleted accounts', () => {
  const DELETED_AT = '2026-10-20T00:00:00.000Z';
  const live = account({ id: 'live', type: 'bank', lastFour: '1111' });
  const gone = account({ id: 'gone', type: 'bank', lastFour: '9999', deletedAt: DELETED_AT });

  it('drops a candidate that exactly matches a deleted account', () => {
    const out = partitionCandidates(
      [parsed('h1', { accountKind: 'bank', lastFour: '9999' })],
      [live, gone],
      new Set(),
    );
    expect(out.matched).toHaveLength(0);
    expect(out.dropped.map(c => c.sourceReferenceHash)).toEqual(['h1']);
    expect(out.unmatched).toHaveLength(0);
  });

  it('drops a candidate whose normalized key has a deleted decision', () => {
    const keys = new Set(['hdfc:credit_card:8123']);
    const out = partitionCandidates(
      [parsed('h1', { accountKind: 'credit_card', bankCanonical: 'hdfc', lastFour: '8123' })],
      [live],
      keys,
    );
    expect(out.dropped).toHaveLength(1);
    expect(out.unmatched).toHaveLength(0);
  });

  it('uses the empty sentinel for a candidate without last four', () => {
    expect(
      isOwnedByDeletedAccount([], new Set(['sbi:upi:']), {
        accountKind: 'upi',
        bankCanonical: 'sbi',
        lastFour: null,
      }),
    ).toBe(true);
  });

  it('never matches SMS to a deleted account', () => {
    expect(resolveAccountIdForSms([live], { accountKind: 'bank', lastFour: '9999' })).toBeNull();
    const out = partitionCandidates(
      [parsed('h1', { accountKind: 'bank', lastFour: '1111' })],
      [live, gone],
      new Set(),
    );
    expect(out.matched).toEqual([{ parsed: expect.anything(), accountId: 'live' }]);
  });

  it('active account wins over a deleted decision with the same key', () => {
    const out = partitionCandidates(
      [parsed('h1', { accountKind: 'bank', bankCanonical: 'unknown', lastFour: '1111' })],
      [live],
      new Set(['unknown:bank:1111']),
    );
    expect(out.matched).toHaveLength(1);
    expect(out.dropped).toHaveLength(0);
  });

  it('leaves unrelated candidates as suggestions', () => {
    const out = partitionCandidates(
      [parsed('h1', { accountKind: 'bank', bankCanonical: 'axis', lastFour: '4444' })],
      [live, gone],
      new Set(['hdfc:bank:1859']),
    );
    expect(out.unmatched).toHaveLength(1);
  });

  it('once restored (deletedAt cleared, decision removed) the account matches again', () => {
    const restored = { ...gone, deletedAt: null };
    const out = partitionCandidates(
      [parsed('h1', { accountKind: 'bank', lastFour: '9999' })],
      [live, restored],
      new Set(),
    );
    expect(out.matched.map(m => m.accountId)).toEqual(['gone']);
  });
});
