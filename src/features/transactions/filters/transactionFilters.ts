import { Transaction } from '../../../domain/transactions/transaction.types';
import { incomeExpenseTotals } from '../../../domain/transactions/transaction.rules';
import { touchesAccount } from '../../../domain/transfers/transfer.rules';

/** R3a adds 'transfer' (the "Transfers" chip). */
export type TypeFilter = 'all' | 'expense' | 'income' | 'transfer';

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

type Filterable = Pick<Transaction, 'type' | 'accountId' | 'categoryId' | 'merchantName' | 'note'> &
  Partial<Pick<Transaction, 'transferAccountId' | 'linkKind'>>;

/** The single predicate every Transactions-list filter goes through. */
export function matchesTransactionFilters(
  transaction: Filterable,
  filters: TransactionFilters,
): boolean {
  if (filters.type !== 'all' && transaction.type !== filters.type) return false;
  // R3a: a transfer matches an account filter on EITHER side (out on A, in on B).
  if (filters.accountId !== null && !touchesAccount(transaction, filters.accountId)) return false;
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
  const transfer = base.filter(t => t.type === 'transfer').length;
  return { all: base.length, expense, income, transfer };
}

export interface FilteredTotals {
  inflowMinor: number;
  spentMinor: number;
  netMinor: number;
}

/**
 * Inflow / Spent / Net of a (filtered) list. R3a: goes through the single
 * income/expense rule — transfers and transfer twins never count.
 */
export function totalsFor(
  transactions: ReadonlyArray<
    Pick<Transaction, 'type' | 'amountMinor'> & Partial<Pick<Transaction, 'linkKind'>>
  >,
): FilteredTotals {
  const totals = incomeExpenseTotals(transactions);
  return {
    inflowMinor: totals.incomeMinor,
    spentMinor: totals.expenseMinor,
    netMinor: totals.netMinor,
  };
}
