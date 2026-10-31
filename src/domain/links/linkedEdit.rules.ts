import { Transaction, TransactionType } from '../transactions/transaction.types';
import { isLinkedRefund } from '../transactions/transaction.rules';
import { leftToRefundMinor, refundedMinor } from '../refunds/refund.rules';

/**
 * R3b.1 — edit guard for linked rows. Pure rules (no React, no store, no SQL);
 * the Edit form shows the error inline and the store refuses the same edits.
 */

/**
 * Hidden rows (a transfer twin, a hidden duplicate) are kept only for SMS
 * dedup: they are never edited. Restore them first ("Undo transfer" /
 * "Not a duplicate").
 */
export function canEditTransaction(t: Pick<Transaction, 'linkKind'>): boolean {
  return t.linkKind !== 'transfer_twin' && t.linkKind !== 'duplicate';
}

export type LinkedEditReason =
  | 'hidden'
  | 'refund-type'
  | 'refund-over'
  | 'expense-type'
  | 'expense-below-refunded';

export interface LinkedEditError {
  /** The form field the error belongs to. */
  field: 'type' | 'amount';
  reason: LinkedEditReason;
  /** 'refund-over': still refundable; 'expense-below-refunded': already refunded (paise). */
  limitMinor?: number;
}

/**
 * Validate an edit of `before` to `next` (type + amount in paise) against the
 * links on it. Null = allowed.
 *  - a linked refund must stay income, and may not grow past what is still
 *    refundable on its expense;
 *  - an expense with linked refunds must stay an expense, and may not drop
 *    below the sum already refunded.
 */
export function linkedEditError(
  before: Transaction,
  next: { type: TransactionType; amountMinor: number },
  transactions: ReadonlyArray<Transaction>,
): LinkedEditError | null {
  if (!canEditTransaction(before)) {
    return { field: 'type', reason: 'hidden' };
  }

  if (isLinkedRefund(before)) {
    if (next.type !== 'income') {
      return { field: 'type', reason: 'refund-type' };
    }
    const expense = transactions.find(t => t.id === before.linkedTransactionId);
    if (expense) {
      const left = leftToRefundMinor(expense, transactions, before.id);
      if (next.amountMinor > left) {
        return { field: 'amount', reason: 'refund-over', limitMinor: left };
      }
    }
    return null;
  }

  if (before.type === 'expense') {
    const refunded = refundedMinor(transactions, before.id);
    if (refunded > 0) {
      if (next.type !== 'expense') {
        return { field: 'type', reason: 'expense-type' };
      }
      if (next.amountMinor < refunded) {
        return { field: 'amount', reason: 'expense-below-refunded', limitMinor: refunded };
      }
    }
  }
  return null;
}
