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
  Partial<Pick<Transaction, 'linkKind' | 'linkedTransactionId'>>;

/**
 * R3b: an income row linked to the expense it gives money back for. It is
 * NOT income: it reduces spend (in the period of the refund's own date).
 * Balances are unchanged — the refund money still enters its account.
 */
export function isLinkedRefund(transaction: IncomeExpenseSubject): boolean {
  return (
    transaction.type === 'income' &&
    transaction.linkKind === 'refund' &&
    transaction.linkedTransactionId != null
  );
}

/**
 * R3a — the SINGLE rule every income/expense total goes through (Home
 * income/expense, Transactions Inflow/Spent/Net + day nets, the
 * Uncategorised count, Activity impact lines, any per-category sum).
 * Transfers between own accounts, the kept SMS twin of a confirmed transfer
 * and (R3b) a hidden duplicate never count. Status is NOT checked here —
 * callers pass the rows they total (e.g. approved only). A linked refund
 * DOES count — as negative spend (see `incomeExpenseTotals`).
 */
export function countsTowardIncomeExpense(transaction: IncomeExpenseSubject): boolean {
  if (transaction.type !== 'income' && transaction.type !== 'expense') return false;
  return transaction.linkKind !== 'transfer_twin' && transaction.linkKind !== 'duplicate';
}

/**
 * R3b: what one row adds to SPEND (paise). Expense → +amount, linked refund →
 * −amount, anything else → 0. Per-category sums (R4) must use this so a
 * refund nets out of its category (the refund carries the original's category).
 */
export function spendContributionMinor(
  transaction: IncomeExpenseSubject & Pick<Transaction, 'amountMinor'>,
): number {
  if (!countsTowardIncomeExpense(transaction)) return 0;
  if (transaction.type === 'expense') return transaction.amountMinor;
  return isLinkedRefund(transaction) ? -transaction.amountMinor : 0;
}

export interface IncomeExpenseTotals {
  incomeMinor: number;
  /** Spend: expenses minus linked refunds (R3b). */
  expenseMinor: number;
  /** income − expense. */
  netMinor: number;
}

/**
 * Sum income and expense over rows that count (see countsTowardIncomeExpense).
 * R3b: a linked refund is not income — it is subtracted from the expense
 * total of the period the caller passes (the refund's own date decides).
 */
export function incomeExpenseTotals(
  transactions: ReadonlyArray<IncomeExpenseSubject & Pick<Transaction, 'amountMinor'>>,
): IncomeExpenseTotals {
  let incomeMinor = 0;
  let expenseMinor = 0;
  for (const t of transactions) {
    if (!countsTowardIncomeExpense(t)) continue;
    if (t.type === 'income' && !isLinkedRefund(t)) incomeMinor += t.amountMinor;
    else expenseMinor += spendContributionMinor(t);
  }
  return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor };
}
