import type { Transaction } from '../transactions/transaction.types';
import type { IouDirection, IouShare, SplitShareInput } from './iou.types';

/**
 * R10 ledger math. PURE: no clock (`now` is passed in), no store, no SQL.
 */

/** Settled shares stay visible for 30 days, then hide behind "Show settled". */
export const SETTLED_VISIBLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isSettled(share: Pick<IouShare, 'settledAt'>): boolean {
  return share.settledAt != null;
}

/** Signed paise: lent counts +, borrowed counts -. */
function signed(share: Pick<IouShare, 'direction' | 'amountMinor'>): number {
  return share.direction === 'lent' ? share.amountMinor : -share.amountMinor;
}

/** A person's NET: unsettled lent minus unsettled borrowed (positive = they owe you). */
export function personNet(shares: ReadonlyArray<IouShare>): number {
  let net = 0;
  for (const share of shares) if (!isSettled(share)) net += signed(share);
  return net;
}

export interface IouTotals {
  youGetMinor: number;
  youOweMinor: number;
}

/** Home tile: sum of unsettled lent / unsettled borrowed. */
export function totals(shares: ReadonlyArray<IouShare>): IouTotals {
  let youGetMinor = 0;
  let youOweMinor = 0;
  for (const share of shares) {
    if (isSettled(share)) continue;
    if (share.direction === 'lent') youGetMinor += share.amountMinor;
    else youOweMinor += share.amountMinor;
  }
  return { youGetMinor, youOweMinor };
}

/** Unsettled, or settled less than 30 days before `now`. */
export function activeShares<T extends Pick<IouShare, 'settledAt'>>(
  shares: ReadonlyArray<T>,
  now: Date,
): T[] {
  const cutoff = now.getTime() - SETTLED_VISIBLE_DAYS * DAY_MS;
  return shares.filter(share => {
    if (share.settledAt == null) return true;
    const at = Date.parse(share.settledAt);
    return Number.isNaN(at) ? true : at >= cutoff;
  });
}

export function hasUnsettled(shares: ReadonlyArray<IouShare>): boolean {
  return shares.some(share => !isSettled(share));
}

export type SplitError =
  | 'no-shares'
  | 'no-person'
  | 'amount-not-positive'
  | 'amount-not-whole'
  | 'over-expense';

/**
 * Split validation: at least one share; each share names a person (existing id
 * or a non-blank new name); each amount is a positive whole number of paise;
 * and the SUM of shares is <= the expense amount (the payer keeps the rest).
 * Shares already recorded against the expense count toward the sum.
 */
export function validateSplit(
  shares: ReadonlyArray<SplitShareInput>,
  expenseAmountMinor: number,
  alreadySplitMinor = 0,
): SplitError | null {
  if (shares.length === 0) return 'no-shares';
  let sum = alreadySplitMinor;
  for (const share of shares) {
    if (!share.personId && !(share.newName ?? '').trim()) return 'no-person';
    if (!Number.isInteger(share.amountMinor)) return 'amount-not-whole';
    if (share.amountMinor <= 0) return 'amount-not-positive';
    sum += share.amountMinor;
  }
  return sum > expenseAmountMinor ? 'over-expense' : null;
}

/** Manual entry (borrowed or lent): a positive whole amount. */
export function validateManualAmount(amountMinor: number): SplitError | null {
  if (!Number.isInteger(amountMinor)) return 'amount-not-whole';
  return amountMinor > 0 ? null : 'amount-not-positive';
}

/** Sum of the unsettled-or-settled lent shares recorded against one expense. */
export function splitTotalForExpense(
  shares: ReadonlyArray<IouShare>,
  expenseId: string,
): { count: number; minor: number; owedMinor: number; owedCount: number } {
  let count = 0;
  let minor = 0;
  let owedMinor = 0;
  let owedCount = 0;
  for (const share of shares) {
    if (share.direction !== 'lent' || share.sourceTransactionId !== expenseId) continue;
    count += 1;
    minor += share.amountMinor;
    if (!isSettled(share)) {
      owedCount += 1;
      owedMinor += share.amountMinor;
    }
  }
  return { count, minor, owedMinor, owedCount };
}

type RepaymentSubject = Pick<Transaction, 'id' | 'type' | 'status'> &
  Partial<Pick<Transaction, 'linkKind' | 'linkedTransactionId' | 'transferAccountId'>>;

/**
 * Credits that can be linked as the repayment of a LENT share: approved,
 * income, carrying no link yet, and not already used by another share.
 */
export function canLinkAsRepayment(
  credit: RepaymentSubject,
  shares: ReadonlyArray<IouShare>,
): boolean {
  return (
    credit.type === 'income' &&
    credit.status === 'approved' &&
    credit.linkKind == null &&
    credit.linkedTransactionId == null &&
    credit.transferAccountId == null &&
    !shares.some(s => s.repaymentTransactionId === credit.id)
  );
}

/** The credit row after being linked as an IOU repayment. */
export function linkRepaymentPatch<T extends Transaction>(
  credit: T,
  sourceExpenseId: string | null,
  now: string,
): T {
  return { ...credit, linkKind: 'iou_repayment', linkedTransactionId: sourceExpenseId, updatedAt: now };
}

/** The credit row after undoing / clearing the repayment link. */
export function unlinkRepaymentPatch<T extends Transaction>(credit: T, now: string): T {
  if (credit.linkKind !== 'iou_repayment') return credit;
  return { ...credit, linkKind: null, linkedTransactionId: null, updatedAt: now };
}

/** Direction label for the person screen. */
export function directionLabel(direction: IouDirection): string {
  return direction === 'lent' ? 'You lent' : 'You borrowed';
}
