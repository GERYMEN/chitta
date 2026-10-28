import { Transaction } from '../../../domain/transactions/transaction.types';

export type TypeFilter = 'all' | 'expense' | 'income';

export interface TransactionFilters {
  type: TypeFilter;
  /** null = every account (active and deleted). */
  accountId: string | null;
  /** null = every category. */
  categoryId: string | null;
  /** Free text; matches merchant OR notes, case-insensitive. */
  query: string;
}

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  type: 'all',
  accountId: null,
  categoryId: null,
  query: '',
};

type Filterable = Pick<Transaction, 'type' | 'accountId' | 'categoryId' | 'merchantName' | 'note'>;

/** The single predicate every Transactions-list filter goes through. */
export function matchesTransactionFilters(
  transaction: Filterable,
  filters: TransactionFilters,
): boolean {
  if (filters.type !== 'all' && transaction.type !== filters.type) return false;
  if (filters.accountId !== null && transaction.accountId !== filters.accountId) return false;
  if (filters.categoryId !== null && transaction.categoryId !== filters.categoryId) return false;

  const needle = filters.query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    transaction.merchantName.toLowerCase().includes(needle) ||
    (transaction.note ?? '').toLowerCase().includes(needle)
  );
}

export function filterTransactions<T extends Filterable>(
  transactions: ReadonlyArray<T>,
  filters: TransactionFilters,
): T[] {
  return transactions.filter(t => matchesTransactionFilters(t, filters));
}

/** True when anything narrows the list (drives the Reset chip + totals label). */
export function hasActiveFilters(filters: TransactionFilters): boolean {
  return (
    filters.type !== 'all' ||
    filters.accountId !== null ||
    filters.categoryId !== null ||
    filters.query.trim() !== ''
  );
}

/**
 * Counts for the All/Expenses/Income chips: every other filter applies, the
 * type filter does not — so each chip shows what tapping it would list.
 */
export function typeCounts(
  transactions: ReadonlyArray<Filterable>,
  filters: TransactionFilters,
): Record<TypeFilter, number> {
  const base = filterTransactions(transactions, { ...filters, type: 'all' });
  const expense = base.filter(t => t.type === 'expense').length;
  const income = base.filter(t => t.type === 'income').length;
  return { all: base.length, expense, income };
}

export interface FilteredTotals {
  inflowMinor: number;
  spentMinor: number;
  netMinor: number;
}

export function totalsFor(
  transactions: ReadonlyArray<Pick<Transaction, 'type' | 'amountMinor'>>,
): FilteredTotals {
  let inflowMinor = 0;
  let spentMinor = 0;
  for (const t of transactions) {
    if (t.type === 'income') inflowMinor += t.amountMinor;
    else spentMinor += t.amountMinor;
  }
  return { inflowMinor, spentMinor, netMinor: inflowMinor - spentMinor };
}
