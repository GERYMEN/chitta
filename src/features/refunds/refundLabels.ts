import { Transaction } from '../../domain/transactions/transaction.types';
import { LinkedEditError } from '../../domain/links/linkedEdit.rules';
import { formatRupeesFromMinor } from '../../shared/utils/currency';
import { formatTransactionTimestamp } from '../../shared/utils/date';

/** R3b pure display strings for refunds (picker, detail). */

const money = (minor: number) => formatRupeesFromMinor(minor, { showPaise: true });

/** Picker row line 2: "<date> · ₹300.00". */
export function refundCandidateMeta(expense: Pick<Transaction, 'occurredAt' | 'amountMinor'>): string {
  return `${formatTransactionTimestamp(expense.occurredAt)} · ${money(expense.amountMinor)}`;
}

/** Picker row line 3: "₹200.00 left to refund". */
export function leftToRefundLabel(leftMinor: number): string {
  return `${money(leftMinor)} left to refund`;
}

/** Linked refund detail: "Refund for <merchant> · <date>". */
export function refundForLabel(expense: Pick<Transaction, 'merchantName' | 'occurredAt'>): string {
  return `Refund for ${expense.merchantName} · ${formatTransactionTimestamp(expense.occurredAt)}`;
}

/** Expense detail: "Refunded ₹100.00". */
export function refundedLabel(refundedMinor: number): string {
  return `Refunded ${money(refundedMinor)}`;
}

/** One refund row under the expense: "₹100.00 · <date>". */
export function refundRowLine(refund: Pick<Transaction, 'amountMinor' | 'occurredAt'>): string {
  return `${money(refund.amountMinor)} · ${formatTransactionTimestamp(refund.occurredAt)}`;
}

/** R3b.1: inline Edit-form copy for a refused edit of a linked row. */
export function linkedEditMessage(error: Pick<LinkedEditError, 'reason' | 'limitMinor'>): string {
  switch (error.reason) {
    case 'hidden':
      return 'This item is hidden and cannot be edited. Restore it first.';
    case 'refund-type':
      return 'A linked refund must stay income. Unlink the refund first.';
    case 'refund-over':
      return `Refunds for this expense would be more than what was spent (${money(error.limitMinor ?? 0)} left to refund).`;
    case 'expense-type':
      return 'This expense has linked refunds. Unlink them first.';
    case 'expense-below-refunded':
      return `Cannot be less than the ${money(error.limitMinor ?? 0)} already refunded.`;
  }
}
