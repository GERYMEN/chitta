import { Transaction, TransactionStatus } from './transaction.types';

/**
 * Confidence policy (docs/PROJECT.md §15).
 * Confidence never equals approval — it only decides which affordance
 * ("Approve" vs "Review") is primary in the UI.
 */
export const CONFIDENCE_HIGH = 90;
export const CONFIDENCE_NEEDS_REVIEW = 70;

export type ConfidenceTier = 'high' | 'needsReview' | 'uncertain';

export function confidenceTier(score: number | null): ConfidenceTier {
  if (score === null) return 'uncertain';
  if (score >= CONFIDENCE_HIGH) return 'high';
  if (score >= CONFIDENCE_NEEDS_REVIEW) return 'needsReview';
  return 'uncertain';
}

export function canFastApprove(score: number | null): boolean {
  return confidenceTier(score) === 'high';
}

/**
 * Only an explicit user action moves a transaction into a state that
 * affects the ledger. Confidence, detection, and parsing never do.
 */
export const LEDGER_AFFECTING_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  'approved',
]);

export function affectsBalance(transaction: Pick<Transaction, 'status'>): boolean {
  return LEDGER_AFFECTING_STATUSES.has(transaction.status);
}

const VALID_TRANSITIONS: Record<TransactionStatus, ReadonlySet<TransactionStatus>> = {
  pending: new Set(['approved', 'rejected']),
  approved: new Set([]),
  rejected: new Set([]),
  invalid: new Set([]),
};

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return VALID_TRANSITIONS[from].has(to);
}

type IncomeExpenseSubject = Pick<Transaction, 'type'> &
  Partial<Pick<Transaction, 'linkKind'>>;

/**
 * R3a — the SINGLE rule every income/expense total goes through (Home
 * income/expense, Transactions Inflow/Spent/Net + day nets, the
 * Uncategorised count, Activity impact lines, any per-category sum).
 * Transfers between own accounts and the kept SMS twin of a confirmed
 * transfer never count. Status is NOT checked here — callers pass the rows
 * they total (e.g. approved only).
 */
export function countsTowardIncomeExpense(transaction: IncomeExpenseSubject): boolean {
  if (transaction.type !== 'income' && transaction.type !== 'expense') return false;
  return transaction.linkKind !== 'transfer_twin';
}

export interface IncomeExpenseTotals {
  incomeMinor: number;
  expenseMinor: number;
  /** income − expense. */
  netMinor: number;
}

/** Sum income and expense over rows that count (see countsTowardIncomeExpense). */
export function incomeExpenseTotals(
  transactions: ReadonlyArray<IncomeExpenseSubject & Pick<Transaction, 'amountMinor'>>,
): IncomeExpenseTotals {
  let incomeMinor = 0;
  let expenseMinor = 0;
  for (const t of transactions) {
    if (!countsTowardIncomeExpense(t)) continue;
    if (t.type === 'income') incomeMinor += t.amountMinor;
    else expenseMinor += t.amountMinor;
  }
  return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor };
}
