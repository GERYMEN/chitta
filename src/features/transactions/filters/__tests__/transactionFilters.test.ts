import {
  canResetFilters,
  categoryFilterFor,
  DEFAULT_TRANSACTION_FILTERS,
  filterTransactions,
  hasActiveFilters,
  matchesTransactionFilters,
  merchantFilterFor,
  totalsFor,
  TransactionFilters,
  typeCounts,
} from '../transactionFilters';
import { periodRange } from '../../../../domain/periods/period.rules';

type Row = {
  id: string;
  type: 'income' | 'expense';
  accountId: string;
  categoryId: string;
  merchantName: string;
  note: string | null;
  amountMinor: number;
  occurredAt: string;
};

const AT = '2026-10-10T10:00:00.000Z';
const ROWS: Row[] = [
  { id: '1', type: 'expense', accountId: 'acc-a', categoryId: 'cat-food', merchantName: 'QA-Merchant-07', note: 'QA note', amountMinor: 5000, occurredAt: AT },
  { id: '2', type: 'expense', accountId: 'acc-b', categoryId: 'cat-shopping', merchantName: 'QA-Bazaar', note: null, amountMinor: 20000, occurredAt: AT },
  { id: '3', type: 'income', accountId: 'acc-a', categoryId: 'cat-salary', merchantName: 'QA-Employer', note: 'October pay', amountMinor: 100000, occurredAt: AT },
  { id: '4', type: 'expense', accountId: 'acc-deleted', categoryId: 'cat-food', merchantName: 'QA-Cafe', note: 'qa NOTE lower', amountMinor: 1500, occurredAt: AT },
];

const f = (patch: Partial<TransactionFilters>): TransactionFilters => ({
  ...DEFAULT_TRANSACTION_FILTERS,
  ...patch,
});
const ids = (filters: TransactionFilters) => filterTransactions(ROWS, filters).map(r => r.id);

describe('matchesTransactionFilters', () => {
  it('default filters match everything', () => {
    expect(ids(DEFAULT_TRANSACTION_FILTERS)).toEqual(['1', '2', '3', '4']);
    expect(hasActiveFilters(DEFAULT_TRANSACTION_FILTERS)).toBe(false);
  });

  it('type chips actually filter', () => {
    expect(ids(f({ type: 'expense' }))).toEqual(['1', '2', '4']);
    expect(ids(f({ type: 'income' }))).toEqual(['3']);
  });

  it('account filter, including a deleted account', () => {
    expect(ids(f({ accountId: 'acc-a' }))).toEqual(['1', '3']);
    expect(ids(f({ accountId: 'acc-deleted' }))).toEqual(['4']);
  });

  it('category filter', () => {
    expect(ids(f({ categoryId: 'cat-food' }))).toEqual(['1', '4']);
  });

  it('search matches merchant OR notes, case-insensitive, trimmed', () => {
    expect(ids(f({ query: 'qa note' }))).toEqual(['1', '4']);
    expect(ids(f({ query: '  BAZAAR ' }))).toEqual(['2']);
    expect(ids(f({ query: 'october' }))).toEqual(['3']);
    expect(ids(f({ query: 'qa-merchant' }))).toEqual(['1']);
    expect(ids(f({ query: 'nothing-matches' }))).toEqual([]);
  });

  it('whitespace-only query is not a filter', () => {
    expect(ids(f({ query: '   ' }))).toEqual(['1', '2', '3', '4']);
    expect(hasActiveFilters(f({ query: '   ' }))).toBe(false);
  });

  it('combinations AND together', () => {
    expect(ids(f({ type: 'expense', accountId: 'acc-a' }))).toEqual(['1']);
    expect(ids(f({ type: 'expense', categoryId: 'cat-food', query: 'note' }))).toEqual(['1', '4']);
    expect(ids(f({ type: 'income', categoryId: 'cat-food' }))).toEqual([]);
    expect(ids(f({ accountId: 'acc-a', categoryId: 'cat-salary', query: 'pay' }))).toEqual(['3']);
  });

  it('null note never throws', () => {
    expect(matchesTransactionFilters(ROWS[1], f({ query: 'x' }))).toBe(false);
  });

  it('hasActiveFilters for each dimension', () => {
    expect(hasActiveFilters(f({ type: 'income' }))).toBe(true);
    expect(hasActiveFilters(f({ accountId: 'acc-a' }))).toBe(true);
    expect(hasActiveFilters(f({ categoryId: 'cat-food' }))).toBe(true);
    expect(hasActiveFilters(f({ query: 'a' }))).toBe(true);
  });
});

describe('typeCounts and totals', () => {
  it('chip counts ignore the type filter but respect the others', () => {
    expect(typeCounts(ROWS, f({ type: 'income', accountId: 'acc-a' }))).toEqual({
      all: 2,
      expense: 1,
      income: 1,
      transfer: 0,
    });
  });

  it('totals follow the filtered set', () => {
    expect(totalsFor(filterTransactions(ROWS, f({ accountId: 'acc-a' })))).toEqual({
      inflowMinor: 100000,
      spentMinor: 5000,
      netMinor: 95000,
    });
    expect(totalsFor([])).toEqual({ inflowMinor: 0, spentMinor: 0, netMinor: 0 });
  });
});

describe('R3a transfers in the Transactions list', () => {
  type TRow = {
    id: string;
    type: 'income' | 'expense' | 'transfer';
    accountId: string;
    transferAccountId?: string | null;
    linkKind?: 'transfer_twin' | null;
    categoryId: string;
    merchantName: string;
    note: string | null;
    amountMinor: number;
    occurredAt: string;
  };
  const T_ROWS: TRow[] = [
    ...ROWS,
    { id: 't1', type: 'transfer', accountId: 'acc-a', transferAccountId: 'acc-w', categoryId: 'cat-transfer', merchantName: 'Transfer', note: 'QA transfer', amountMinor: 50000, occurredAt: AT },
    { id: 't2', type: 'transfer', accountId: 'acc-w', transferAccountId: 'acc-b', categoryId: 'cat-transfer', merchantName: 'QA-Merchant-09', note: null, amountMinor: 10000, occurredAt: AT },
  ];
  const tIds = (filters: TransactionFilters) => filterTransactions(T_ROWS, filters).map(r => r.id);

  it('the Transfers chip lists only transfers and counts them', () => {
    expect(tIds(f({ type: 'transfer' }))).toEqual(['t1', 't2']);
    expect(typeCounts(T_ROWS, f({}))).toEqual({ all: 6, expense: 3, income: 1, transfer: 2 });
  });

  it('an account filter matches either side of a transfer', () => {
    expect(tIds(f({ accountId: 'acc-w' }))).toEqual(['t1', 't2']);
    expect(tIds(f({ accountId: 'acc-a' }))).toEqual(['1', '3', 't1']);
    expect(tIds(f({ accountId: 'acc-b' }))).toEqual(['2', 't2']);
  });

  it('totals exclude transfers and transfer twins', () => {
    const withTwin: TRow[] = [
      ...T_ROWS,
      { id: 'twin', type: 'income', accountId: 'acc-w', linkKind: 'transfer_twin', categoryId: 'cat-uncategorised', merchantName: 'X', note: null, amountMinor: 50000, occurredAt: AT },
    ];
    expect(totalsFor(withTwin)).toEqual(totalsFor(ROWS));
    expect(totalsFor(filterTransactions(T_ROWS, f({ type: 'transfer' })))).toEqual({
      inflowMinor: 0,
      spentMinor: 0,
      netMinor: 0,
    });
  });
});

describe('R4 period range + merchant key in the predicate', () => {
  // Local wall-clock dates → ISO, so the tests hold in any timezone.
  const local = (y: number, m: number, d: number, h = 0, min = 0, sec = 0, ms = 0) =>
    new Date(y, m - 1, d, h, min, sec, ms).toISOString();
  const NOW = new Date(2026, 9, 20, 15, 0, 0, 0); // 20 Oct 2026 15:00 local
  const ONE_MONTH = periodRange('1M', NOW); // 1 Oct 00:00 → now
  const THREE_MONTHS = periodRange('3M', NOW); // 1 Aug 00:00 → now

  const P_ROWS: Row[] = [
    { id: 'p1', type: 'expense', accountId: 'acc-a', categoryId: 'cat-food', merchantName: 'QA-Merchant-12', note: null, amountMinor: 1000, occurredAt: local(2026, 10, 1) },
    { id: 'p2', type: 'expense', accountId: 'acc-a', categoryId: 'cat-food', merchantName: 'qa merchant 12', note: null, amountMinor: 2000, occurredAt: local(2026, 9, 30, 23, 59, 59, 999) },
    { id: 'p3', type: 'income', accountId: 'acc-b', categoryId: 'cat-salary', merchantName: 'QA-Employer', note: null, amountMinor: 50000, occurredAt: local(2026, 10, 5, 9) },
    { id: 'p4', type: 'expense', accountId: 'acc-b', categoryId: 'cat-shopping', merchantName: 'QA-Merchant-12@okqa', note: null, amountMinor: 4000, occurredAt: NOW.toISOString() },
    { id: 'p5', type: 'expense', accountId: 'acc-a', categoryId: 'cat-food', merchantName: 'QA-Merchant-13', note: null, amountMinor: 8000, occurredAt: new Date(NOW.getTime() + 1).toISOString() },
    { id: 'p6', type: 'expense', accountId: 'acc-a', categoryId: 'cat-food', merchantName: 'QA-Merchant-12', note: null, amountMinor: 16000, occurredAt: local(2026, 8, 1) },
    { id: 'p7', type: 'expense', accountId: 'acc-a', categoryId: 'cat-food', merchantName: 'QA-Merchant-12', note: null, amountMinor: 32000, occurredAt: local(2026, 7, 31, 23, 59, 59, 999) },
  ];
  const pIds = (filters: TransactionFilters, range: ReturnType<typeof periodRange> | null) =>
    filterTransactions(P_ROWS, filters, range).map(r => r.id);
  const KEY = 'qa merchant 12';

  it('the period keeps 1st-of-month midnight (inclusive) through now (inclusive)', () => {
    expect(pIds(DEFAULT_TRANSACTION_FILTERS, ONE_MONTH)).toEqual(['p1', 'p3', 'p4']);
    expect(pIds(DEFAULT_TRANSACTION_FILTERS, THREE_MONTHS)).toEqual(['p1', 'p2', 'p3', 'p4', 'p6']);
    // No range = no period limit (callers that do not pass one are unchanged).
    expect(pIds(DEFAULT_TRANSACTION_FILTERS, null)).toHaveLength(7);
  });

  it('period + category', () => {
    expect(pIds(f({ categoryId: 'cat-food' }), ONE_MONTH)).toEqual(['p1']);
    expect(pIds(f({ categoryId: 'cat-food' }), THREE_MONTHS)).toEqual(['p1', 'p2', 'p6']);
  });

  it('merchantKey matches by normalizeMerchant (case, spacing, UPI handle) within the period', () => {
    expect(pIds(f({ merchantKey: KEY }), ONE_MONTH)).toEqual(['p1', 'p4']);
    expect(pIds(f({ merchantKey: KEY }), THREE_MONTHS)).toEqual(['p1', 'p2', 'p4', 'p6']);
    expect(pIds(f({ merchantKey: 'qa merchant 13' }), ONE_MONTH)).toEqual([]);
  });

  it('period + category + merchantKey (+ type, + search) AND together', () => {
    expect(pIds(f({ merchantKey: KEY, categoryId: 'cat-food' }), THREE_MONTHS)).toEqual(['p1', 'p2', 'p6']);
    expect(pIds(f({ merchantKey: KEY, categoryId: 'cat-shopping' }), ONE_MONTH)).toEqual(['p4']);
    expect(pIds(f({ merchantKey: KEY, type: 'income' }), THREE_MONTHS)).toEqual([]);
    // The search box stays its own filter: both must match.
    expect(pIds(f({ merchantKey: KEY, query: 'okqa' }), THREE_MONTHS)).toEqual(['p4']);
    expect(pIds(f({ merchantKey: KEY, accountId: 'acc-b' }), ONE_MONTH)).toEqual(['p4']);
  });

  it('chip counts and totals follow the period', () => {
    expect(typeCounts(P_ROWS, DEFAULT_TRANSACTION_FILTERS, ONE_MONTH)).toEqual({
      all: 3,
      expense: 2,
      income: 1,
      transfer: 0,
    });
    expect(totalsFor(filterTransactions(P_ROWS, DEFAULT_TRANSACTION_FILTERS, ONE_MONTH))).toEqual({
      inflowMinor: 50000,
      spentMinor: 5000,
      netMinor: 45000,
    });
    expect(totalsFor(filterTransactions(P_ROWS, f({ merchantKey: KEY }), THREE_MONTHS))).toEqual({
      inflowMinor: 0,
      spentMinor: 23000,
      netMinor: -23000,
    });
  });

  it('merchantKey is a filter; Reset shows for any filter or a non-1M period', () => {
    expect(hasActiveFilters(f({ merchantKey: KEY }))).toBe(true);
    expect(canResetFilters(DEFAULT_TRANSACTION_FILTERS, '1M')).toBe(false);
    expect(canResetFilters(DEFAULT_TRANSACTION_FILTERS, '3M')).toBe(true);
    expect(canResetFilters(f({ merchantKey: KEY }), '1M')).toBe(true);
  });

  it('merchantFilterFor / categoryFilterFor start from the defaults (other filters cleared)', () => {
    expect(merchantFilterFor('  QA-Merchant-12@okqa ')).toEqual({
      ...DEFAULT_TRANSACTION_FILTERS,
      merchantKey: KEY,
      merchantLabel: 'QA-Merchant-12@okqa',
    });
    expect(categoryFilterFor('cat-food')).toEqual({ ...DEFAULT_TRANSACTION_FILTERS, categoryId: 'cat-food' });
  });
});
