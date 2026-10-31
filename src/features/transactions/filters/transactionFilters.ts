import { Transaction } from '../../../domain/transactions/transaction.types';
import { incomeExpenseTotals } from '../../../domain/transactions/transaction.rules';
import { touchesAccount } from '../../../domain/transfers/transfer.rules';
import { normalizeMerchant } from '../../../domain/merchants/normalizeMerchant';
import { Period, PeriodRange } from '../../../domain/periods/period.types';
import { DEFAULT_PERIOD, isWithinRange } from '../../../domain/periods/period.rules';

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
  /**
   * R4: normalizeMerchant key set by the Transaction-detail merchant chip
   * ("Merchant: <name> ✕"); null = any merchant. The search box is separate.
   */
  merchantKey: string | null;
  /** R4: display name for the merchant chip only — never matched on. */
  merchantLabel: string | null;
}

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  type: 'all',
  accountId: null,
  categoryId: null,
  query: '',
  merchantKey: null,
  merchantLabel: null,
};

type Filterable = Pick<
  Transaction,
  'type' | 'accountId' | 'categoryId' | 'merchantName' | 'note' | 'occurredAt'
> &
  Partial<Pick<Transaction, 'transferAccountId' | 'linkKind'>>;

/**
 * The single predicate every Transactions-list filter goes through. R4: it
 * also takes the selected period's range (both ends inclusive; `to` = the
 * screen's injected now). `null` = no period limit.
 */
export function matchesTransactionFilters(
  transaction: Filterable,
  filters: TransactionFilters,
  range: PeriodRange | null = null,
): boolean {
  if (filters.type !== 'all' && transaction.type !== filters.type) return false;
  // R3a: a transfer matches an account filter on EITHER side (out on A, in on B).
  if (filters.accountId !== null && !touchesAccount(transaction, filters.accountId)) return false;
  if (filters.categoryId !== null && transaction.categoryId !== filters.categoryId) return false;
  if (range !== null && !isWithinRange(transaction.occurredAt, range)) return false;
  // R4: the same merchant key the detail chip counts with (merchantHistory).
  if (
    filters.merchantKey !== null &&
    normalizeMerchant(transaction.merchantName) !== filters.merchantKey
  ) {
    return false;
  }

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
  range: PeriodRange | null = null,
): T[] {
  return transactions.filter(t => matchesTransactionFilters(t, filters, range));
}

/** True when anything besides the period narrows the list (drives the totals label). */
export function hasActiveFilters(filters: TransactionFilters): boolean {
  return (
    filters.type !== 'all' ||
    filters.accountId !== null ||
    filters.categoryId !== null ||
    filters.query.trim() !== '' ||
    filters.merchantKey !== null
  );
}

/** R4: the Reset chip shows when a filter is on OR the period is not the default 1M. */
export function canResetFilters(filters: TransactionFilters, period: Period): boolean {
  return hasActiveFilters(filters) || period !== DEFAULT_PERIOD;
}

/**
 * R4: Insights category bar → Transactions showing exactly that category in
 * the current period (the other filters are cleared so SPENT equals the bar).
 */
export function categoryFilterFor(categoryId: string): TransactionFilters {
  return { ...DEFAULT_TRANSACTION_FILTERS, categoryId };
}

/**
 * R4: detail merchant chip → Transactions showing that merchant key in the
 * current period (the other filters are cleared so the list matches the
 * chip's count).
 */
export function merchantFilterFor(merchantName: string): TransactionFilters {
  return {
    ...DEFAULT_TRANSACTION_FILTERS,
    merchantKey: normalizeMerchant(merchantName),
    merchantLabel: merchantName.trim(),
  };
}

/**
 * Counts for the All/Expenses/Income chips: every other filter applies, the
 * type filter does not — so each chip shows what tapping it would list.
 */
export function typeCounts(
  transactions: ReadonlyArray<Filterable>,
  filters: TransactionFilters,
  range: PeriodRange | null = null,
): Record<TypeFilter, number> {
  const base = filterTransactions(transactions, { ...filters, type: 'all' }, range);
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
    Pick<Transaction, 'type' | 'amountMinor'> &
      Partial<Pick<Transaction, 'linkKind' | 'linkedTransactionId'>>
  >,
): FilteredTotals {
  const totals = incomeExpenseTotals(transactions);
  return {
    inflowMinor: totals.incomeMinor,
    spentMinor: totals.expenseMinor,
    netMinor: totals.netMinor,
  };
}
