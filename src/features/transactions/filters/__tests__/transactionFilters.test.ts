import {
  DEFAULT_TRANSACTION_FILTERS,
  filterTransactions,
  hasActiveFilters,
  matchesTransactionFilters,
  totalsFor,
  TransactionFilters,
  typeCounts,
} from '../transactionFilters';

type Row = {
  id: string;
  type: 'income' | 'expense';
  accountId: string;
  categoryId: string;
  merchantName: string;
  note: string | null;
  amountMinor: number;
};

const ROWS: Row[] = [
  { id: '1', type: 'expense', accountId: 'acc-a', categoryId: 'cat-food', merchantName: 'QA-Merchant-07', note: 'QA note', amountMinor: 5000 },
  { id: '2', type: 'expense', accountId: 'acc-b', categoryId: 'cat-shopping', merchantName: 'Bazaar', note: null, amountMinor: 20000 },
  { id: '3', type: 'income', accountId: 'acc-a', categoryId: 'cat-salary', merchantName: 'Employer', note: 'October pay', amountMinor: 100000 },
  { id: '4', type: 'expense', accountId: 'acc-deleted', categoryId: 'cat-food', merchantName: 'Cafe', note: 'qa NOTE lower', amountMinor: 1500 },
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
