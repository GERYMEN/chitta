import { Account } from '../../domain/accounts/account.types';
import { accountDisplayLabel } from '../../domain/accounts/account.rules';
import { Transaction } from '../../domain/transactions/transaction.types';
import { formatRupeesFromMinor } from '../../shared/utils/currency';
import { formatTransactionTimestamp } from '../../shared/utils/date';

/** R3b pure display strings for duplicates and the combined review nudge. */

type AccountLookup = ReadonlyArray<Pick<Account, 'id' | 'name' | 'lastFour' | 'deletedAt'>>;

/** Pending duplicate card title: "₹50.00 twice on <account>". */
export function duplicatePairTitle(
  t: Pick<Transaction, 'amountMinor' | 'accountId' | 'type'>,
  accounts: AccountLookup,
): string {
  const account = accounts.find(a => a.id === t.accountId) ?? null;
  const kind = t.type === 'income' ? 'in' : 'out';
  return `${formatRupeesFromMinor(t.amountMinor, { showPaise: true })} ${kind} twice on ${accountDisplayLabel(account)}`;
}

/** One side of a pair: "<merchant> · <when>". */
export function duplicateRowLine(t: Pick<Transaction, 'merchantName' | 'occurredAt'>): string {
  return `${t.merchantName} · ${formatTransactionTimestamp(t.occurredAt)}`;
}

/** Status word for one side of a pair. */
export function duplicateRowStatus(t: Pick<Transaction, 'status'>): string {
  return t.status === 'approved' ? 'Approved' : 'Pending';
}

/** Home nudge (transfers + duplicates): "1 to review" / "3 to review". */
export function toReviewLabel(count: number): string {
  return `${count} to review`;
}

/** Kept row detail: "1 duplicate hidden" / "2 duplicates hidden". */
export function hiddenDuplicatesLabel(count: number): string {
  return `${count} duplicate${count === 1 ? '' : 's'} hidden`;
}
