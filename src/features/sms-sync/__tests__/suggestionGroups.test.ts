import { Account } from '../../../domain/accounts/account.types';
import { ParsedSmsTransaction } from '../smsParser';
import {
  decisionKeyFor,
  groupUnmatchedIntoSuggestions,
  partitionCandidates,
} from '../smsSyncLogic';
import {
  formatShortDateRange,
  groupUnmatchedCandidates,
  linkableAccounts,
  proposedAccountBaseName,
  proposedAccountTitle,
  suggestionsSummaryLine,
  summarizeGroup,
  waitingLabel,
} from '../suggestionGroups';
import { toSuggestionDecisions } from '../syncSms';

// syncSms imports the native modules at load time; only the pure helper is used.
jest.mock('../../../native/android/sms/smsReader', () => ({ readInbox: jest.fn() }));
jest.mock('../../../native/android/permissions/smsPermission', () => ({
  checkSmsPermission: jest.fn(),
  requestSmsPermission: jest.fn(),
}));
jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(),
}));

const parsed = (
  hash: string,
  overrides: Partial<ParsedSmsTransaction> = {},
): ParsedSmsTransaction => ({
  type: 'expense',
  amountMinor: 1000,
  merchantName: 'QA-Merchant',
  occurredAt: '2026-10-10T10:00:00.000Z',
  confidenceScore: 90,
  sanitizedPreview: 'Debited ₹10 — QA-Merchant',
  sourceReferenceHash: hash,
  bankName: 'HDFC',
  bankCanonical: 'hdfc',
  accountKind: 'bank',
  lastFour: '1234',
  ...overrides,
});

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'acc-1',
  name: 'QA Bank',
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

describe('groupUnmatchedCandidates (R2b T1)', () => {
  const unmatched = [
    parsed('sms-1-1', { occurredAt: '2026-10-01T00:00:00.000Z' }),
    parsed('sms-2-2', {
      bankName: 'SBI',
      bankCanonical: 'sbi',
      accountKind: 'credit_card',
      lastFour: '5368',
    }),
    parsed('sms-3-3', { occurredAt: '2026-10-20T00:00:00.000Z' }),
    parsed('sms-4-4', { occurredAt: '2026-10-05T00:00:00.000Z' }),
    parsed('sms-5-5', {
      bankName: 'Unknown Bank',
      bankCanonical: 'unknown',
      lastFour: null,
      occurredAt: '2026-09-01T00:00:00.000Z',
    }),
  ];

  it('keeps every candidate under its suggestion key, counts match the suggestions', () => {
    const groups = groupUnmatchedCandidates(unmatched);
    expect(groups.map(g => g.key)).toEqual([
      'bank:HDFC:1234',
      // ties (1 item each) → newest activity first
      'credit_card:SBI:5368',
      'bank:Unknown Bank:unknown',
    ]);
    expect(groups.map(g => g.suggestion)).toEqual(groupUnmatchedIntoSuggestions(unmatched));
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(unmatched.length);
    for (const group of groups) expect(group.items).toHaveLength(group.suggestion.messageCount);
  });

  it('orders items newest first and carries the normalized decision key', () => {
    const [hdfc, sbi, unknown] = groupUnmatchedCandidates(unmatched);
    expect(hdfc.items.map(i => i.sourceReferenceHash)).toEqual(['sms-3-3', 'sms-4-4', 'sms-1-1']);
    expect(hdfc.decisionKey).toBe('hdfc:bank:1234');
    expect(sbi.decisionKey).toBe('sbi:credit_card:5368');
    expect(unknown.decisionKey).toBe('unknown:bank:');
  });

  it('keeps sanitizedPreview as the only SMS text', () => {
    const [group] = groupUnmatchedCandidates([parsed('sms-9-9')]);
    expect(Object.keys(group.items[0])).not.toContain('body');
    expect(Object.keys(group.items[0])).not.toContain('address');
  });

  it('empty input → no groups', () => {
    expect(groupUnmatchedCandidates([])).toEqual([]);
  });
});

describe('proposed account name', () => {
  it.each([
    [{ bankName: 'HDFC', accountKind: 'bank', lastFour: '1234' }, 'HDFC Bank', 'HDFC Bank ••1234'],
    [
      { bankName: 'SBI', accountKind: 'credit_card', lastFour: '5368' },
      'SBI Credit Card',
      'SBI Credit Card ••5368',
    ],
    [
      { bankName: 'Unknown Bank', accountKind: 'bank', lastFour: null },
      'Unknown bank',
      'Unknown bank (no last 4)',
    ],
    [{ bankName: 'Union Bank', accountKind: 'bank', lastFour: '0001' }, 'Union Bank', 'Union Bank ••0001'],
    [{ bankName: 'Bank of India', accountKind: 'bank', lastFour: null }, 'Bank of India', 'Bank of India (no last 4)'],
    [{ bankName: 'ICICI', accountKind: 'upi', lastFour: '4321' }, 'ICICI UPI', 'ICICI UPI ••4321'],
  ] as const)('%j → %s / %s', (suggestion, base, title) => {
    expect(proposedAccountBaseName(suggestion)).toBe(base);
    expect(proposedAccountTitle(suggestion)).toBe(title);
  });
});

describe('card summary', () => {
  it('count, date range and in/out totals', () => {
    const summary = summarizeGroup([
      parsed('a', { type: 'expense', amountMinor: 1050, occurredAt: '2026-10-03T00:00:00.000Z' }),
      parsed('b', { type: 'income', amountMinor: 20000, occurredAt: '2026-10-28T00:00:00.000Z' }),
      parsed('c', { type: 'expense', amountMinor: 50, occurredAt: '2026-10-10T00:00:00.000Z' }),
    ]);
    expect(summary).toEqual({
      count: 3,
      firstAt: '2026-10-03T00:00:00.000Z',
      lastAt: '2026-10-28T00:00:00.000Z',
      inMinor: 20000,
      outMinor: 1100,
    });
  });

  it('summary line and waiting label pluralise', () => {
    expect(suggestionsSummaryLine([{ items: [parsed('a'), parsed('b')] }, { items: [parsed('c')] }])).toBe(
      '2 new accounts · 3 transactions waiting',
    );
    expect(suggestionsSummaryLine([{ items: [parsed('a')] }])).toBe(
      '1 new account · 1 transaction waiting',
    );
    expect(waitingLabel(1)).toBe('1 transaction waiting');
    expect(waitingLabel(27)).toBe('27 transactions waiting');
  });

  it('date range: same day shows one date, otherwise a range', () => {
    const same = formatShortDateRange('2026-10-28T06:00:00.000Z', '2026-10-28T08:00:00.000Z');
    expect(same).not.toContain('–');
    expect(same).toContain('2026');
    expect(formatShortDateRange('2026-10-03T06:00:00.000Z', '2026-10-28T06:00:00.000Z')).toContain('–');
  });
});

describe('linkableAccounts', () => {
  it('active accounts of the same kind without a last four', () => {
    const accounts = [
      account({ id: 'a', type: 'bank', lastFour: null }),
      account({ id: 'b', type: 'bank', lastFour: '9999' }),
      account({ id: 'c', type: 'credit_card', lastFour: null }),
      account({ id: 'd', type: 'bank', lastFour: null, deletedAt: '2026-10-20T00:00:00.000Z' }),
      account({ id: 'e', type: 'bank', lastFour: '  ' }),
    ];
    expect(linkableAccounts(accounts, { accountKind: 'bank' }).map(a => a.id)).toEqual(['a', 'e']);
  });
});

describe('partitionCandidates with suggestion decisions (R2b)', () => {
  const live = account({ id: 'live', type: 'bank', lastFour: null });
  const exact = account({ id: 'exact', type: 'bank', lastFour: '1234' });
  const gone = account({ id: 'gone', deletedAt: '2026-10-20T00:00:00.000Z' });

  it('exact type+lastFour match still wins over a route', () => {
    const c = parsed('h1');
    const out = partitionCandidates([c], [live, exact], new Set(), {
      routes: new Map([[decisionKeyFor(c), 'live']]),
      ignored: new Set(),
    });
    expect(out.matched).toEqual([{ parsed: c, accountId: 'exact' }]);
  });

  it("an 'added'/'linked' route sends unmatched SMS (incl. no last 4) to that account", () => {
    const c = parsed('h1', { lastFour: null, bankCanonical: 'unknown', bankName: 'Unknown Bank' });
    const out = partitionCandidates([c], [live], new Set(), {
      routes: new Map([['unknown:bank:', 'live']]),
      ignored: new Set(),
    });
    expect(out.matched).toEqual([{ parsed: c, accountId: 'live' }]);
  });

  it('a route to a soft-deleted account drops the SMS', () => {
    const c = parsed('h1');
    const out = partitionCandidates([c], [gone], new Set(), {
      routes: new Map([[decisionKeyFor(c), 'gone']]),
      ignored: new Set(),
    });
    expect(out.dropped).toEqual([c]);
    expect(out.matched).toHaveLength(0);
  });

  it('an ignored key is dropped, never suggested', () => {
    const c = parsed('h1');
    const out = partitionCandidates([c], [live], new Set(), {
      routes: new Map(),
      ignored: new Set([decisionKeyFor(c)]),
    });
    expect(out.dropped).toEqual([c]);
    expect(out.unmatched).toHaveLength(0);
  });

  it('no decisions → unchanged behaviour (unmatched)', () => {
    const c = parsed('h1');
    expect(partitionCandidates([c], [live], new Set()).unmatched).toEqual([c]);
  });

  it('toSuggestionDecisions maps rows to routes / ignored (deleted handled elsewhere)', () => {
    const decisions = toSuggestionDecisions([
      { key: 'hdfc:bank:1234', decision: 'added', accountId: 'a1' },
      { key: 'sbi:credit_card:5368', decision: 'linked', accountId: 'a2' },
      { key: 'unknown:bank:', decision: 'ignored', accountId: null },
      { key: 'axis:bank:1111', decision: 'deleted', accountId: 'a3' },
      { key: 'kotak:bank:2222', decision: 'added', accountId: null },
    ]);
    expect(Array.from(decisions.routes.entries())).toEqual([
      ['hdfc:bank:1234', 'a1'],
      ['sbi:credit_card:5368', 'a2'],
    ]);
    expect(Array.from(decisions.ignored)).toEqual(['unknown:bank:']);
  });
});
