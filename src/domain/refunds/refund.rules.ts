import { normalizeMerchant } from '../merchants/normalizeMerchant';
import { Transaction, TransactionStatus } from '../transactions/transaction.types';
import { isLinkedRefund } from '../transactions/transaction.rules';

/**
 * R3b — link a refund to the expense it gives money back for. Pure rules
 * only (no React, no store, no SQL).
 *
 * A refund = an income row with link_kind 'refund' and linked_transaction_id
 * = the original expense id. It keeps its own account, date and status; its
 * category becomes the original's. Totals: it is not income, it reduces spend
 * in the period of the refund's own date (`incomeExpenseTotals`). Balances do
 * not change (the money still entered the refund's account).
 */

/** How far back an original expense may be (days before the refund). */
export const REFUND_LOOKBACK_DAYS = 90;
/** At most this many candidates are offered in the picker. */
export const REFUND_CANDIDATE_LIMIT = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const LIVE_STATUSES: ReadonlySet<TransactionStatus> = new Set(['pending', 'approved']);

type LinkFields = Partial<Pick<Transaction, 'linkKind' | 'linkedTransactionId' | 'transferAccountId'>>;

/** A pending/approved income that is not a transfer and not linked to anything. */
export function canLinkAsRefund(t: Pick<Transaction, 'type' | 'status'> & LinkFields): boolean {
  return (
    t.type === 'income' &&
    LIVE_STATUSES.has(t.status) &&
    t.linkKind == null &&
    t.linkedTransactionId == null &&
    t.transferAccountId == null
  );
}

/** A pending/approved expense that is not linked/rejected/transfer (refunds may point at it). */
export function canBeRefunded(t: Pick<Transaction, 'type' | 'status'> & LinkFields): boolean {
  return (
    t.type === 'expense' &&
    LIVE_STATUSES.has(t.status) &&
    t.linkKind == null &&
    t.linkedTransactionId == null &&
    t.transferAccountId == null
  );
}

/**
 * Live refunds (pending/approved) linked to this expense, newest first.
 * Rejected/invalid refund rows no longer give money back.
 */
export function refundsFor<T extends Transaction>(
  transactions: ReadonlyArray<T>,
  expenseId: string,
): T[] {
  return transactions
    .filter(
      t => isLinkedRefund(t) && t.linkedTransactionId === expenseId && LIVE_STATUSES.has(t.status),
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/** Sum of live refunds linked to this expense (paise), optionally skipping one refund. */
export function refundedMinor(
  transactions: ReadonlyArray<Transaction>,
  expenseId: string,
  excludeRefundId: string | null = null,
): number {
  return refundsFor(transactions, expenseId)
    .filter(t => t.id !== excludeRefundId)
    .reduce((sum, t) => sum + t.amountMinor, 0);
}

/** What is still refundable on this expense (never below 0). */
export function leftToRefundMinor(
  expense: Pick<Transaction, 'id' | 'amountMinor'>,
  transactions: ReadonlyArray<Transaction>,
  excludeRefundId: string | null = null,
): number {
  return Math.max(0, expense.amountMinor - refundedMinor(transactions, expense.id, excludeRefundId));
}

export type RefundLinkError =
  | 'not-a-refund-candidate'
  | 'not-refundable'
  | 'same-row'
  | 'over-refund';

/** Short, plain error copy for a refused link. */
export const REFUND_LINK_ERROR_TEXT: Record<RefundLinkError, string> = {
  'not-a-refund-candidate': 'Only an income that is not already linked can be a refund.',
  'not-refundable': 'That expense can no longer take a refund.',
  'same-row': 'An item cannot be a refund of itself.',
  'over-refund': 'Refunds for this expense would be more than what was spent.',
};

/**
 * Validate "link this income as a refund of that expense". Partial and
 * multiple refunds are fine; the sum of live refunds linked to one expense may
 * not exceed its amount. Null = OK.
 */
export function validateRefundLink(
  refund: Transaction,
  expense: Transaction,
  transactions: ReadonlyArray<Transaction>,
): RefundLinkError | null {
  if (refund.id === expense.id) return 'same-row';
  if (!canLinkAsRefund(refund)) return 'not-a-refund-candidate';
  if (!canBeRefunded(expense)) return 'not-refundable';
  if (refund.amountMinor > leftToRefundMinor(expense, transactions, refund.id)) {
    return 'over-refund';
  }
  return null;
}

export interface RefundCandidate {
  expense: Transaction;
  /** Still refundable on this expense BEFORE linking this refund (paise). */
  leftMinor: number;
  sameMerchant: boolean;
  sameAccount: boolean;
  /** refund.occurredAt − expense.occurredAt (ms, ≥ 0). */
  ageMs: number;
}

/**
 * "Link to original expense" picker: approved/pending expenses, not linked/
 * rejected/transfer, with at least the refund amount still refundable,
 * occurred within REFUND_LOOKBACK_DAYS BEFORE (or at) the refund. Ranked by
 * same normalizeMerchant key, then same account, then closest date, then id.
 */
export function rankRefundCandidates(
  refund: Transaction,
  transactions: ReadonlyArray<Transaction>,
  options: { lookbackDays?: number; limit?: number } = {},
): RefundCandidate[] {
  const lookbackMs = (options.lookbackDays ?? REFUND_LOOKBACK_DAYS) * DAY_MS;
  const limit = options.limit ?? REFUND_CANDIDATE_LIMIT;
  const refundMs = Date.parse(refund.occurredAt);
  if (!Number.isFinite(refundMs)) return [];
  const refundKey = normalizeMerchant(refund.merchantName);

  const candidates: RefundCandidate[] = [];
  for (const expense of transactions) {
    if (expense.id === refund.id || !canBeRefunded(expense)) continue;
    const expenseMs = Date.parse(expense.occurredAt);
    if (!Number.isFinite(expenseMs)) continue;
    const ageMs = refundMs - expenseMs;
    if (ageMs < 0 || ageMs > lookbackMs) continue;
    const leftMinor = leftToRefundMinor(expense, transactions, refund.id);
    if (leftMinor < refund.amountMinor) continue;
    candidates.push({
      expense,
      leftMinor,
      sameMerchant: refundKey !== '' && normalizeMerchant(expense.merchantName) === refundKey,
      sameAccount: expense.accountId === refund.accountId,
      ageMs,
    });
  }

  candidates.sort(
    (a, b) =>
      Number(b.sameMerchant) - Number(a.sameMerchant) ||
      Number(b.sameAccount) - Number(a.sameAccount) ||
      a.ageMs - b.ageMs ||
      (a.expense.id < b.expense.id ? -1 : a.expense.id > b.expense.id ? 1 : 0),
  );
  return candidates.slice(0, Math.max(0, limit));
}

/** The refund row after linking: link fields + the original's category. */
export function linkRefundPatch(
  refund: Transaction,
  expense: Transaction,
  now: string,
): Transaction {
  return {
    ...refund,
    linkKind: 'refund',
    linkedTransactionId: expense.id,
    categoryId: expense.categoryId,
    updatedAt: now,
  };
}

/**
 * The refund row after "Unlink refund": link fields cleared; its category
 * goes back to what it was before linking when that is known and the
 * category has not been changed since (else it is left as is).
 */
export function unlinkRefundPatch(
  refund: Transaction,
  previousCategoryId: string | null,
  linkedCategoryId: string | null,
  now: string,
): Transaction | null {
  if (!isLinkedRefund(refund)) return null;
  const restoreCategory =
    previousCategoryId != null &&
    (linkedCategoryId == null || refund.categoryId === linkedCategoryId);
  return {
    ...refund,
    linkKind: null,
    linkedTransactionId: null,
    categoryId: restoreCategory ? previousCategoryId : refund.categoryId,
    updatedAt: now,
  };
}
