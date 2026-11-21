import { Account } from './account.types';
import { calculateBalance, isLiabilityAccount } from './account.rules';

/**
 * R6 (D-c): where Tracker's balance and the bank's SMS-reported balance stand.
 * Pure — no I/O, no clock. `diffMinor = trackedMinor - bankMinor`:
 *   > 0  Tracker shows MORE than the bank  (an expense is likely missing)
 *   < 0  Tracker shows LESS than the bank  (an income is likely missing)
 *   = 0  reconciled
 */
export interface BalanceReconciliation {
  trackedMinor: number;
  bankMinor: number;
  diffMinor: number;
  /** ISO time of the SMS that reported the bank balance. */
  asOf: string;
}

type ReconcileAccount = Pick<
  Account,
  'type' | 'openingBalanceMinor' | 'balanceAnchorMinor' | 'balanceAnchorAt' | 'smsBalanceMinor' | 'smsBalanceAt'
>;

/**
 * null when there is no snapshot. Also null for liability accounts (credit
 * card / pay later): an SMS "balance" there may be available credit, not the
 * ledger, so a difference would be meaningless. The tracked side REUSES
 * `calculateBalance` (including the user anchor) — nothing is re-summed.
 */
export function reconcileBalance(
  account: ReconcileAccount,
  transactions: Parameters<typeof calculateBalance>[1],
  accountId: string,
): BalanceReconciliation | null {
  if (account.smsBalanceMinor == null || account.smsBalanceAt == null) return null;
  if (isLiabilityAccount(account.type) || account.type === 'pay_later') return null;
  const trackedMinor = calculateBalance(account, transactions, accountId);
  return {
    trackedMinor,
    bankMinor: account.smsBalanceMinor,
    diffMinor: trackedMinor - account.smsBalanceMinor,
    asOf: account.smsBalanceAt,
  };
}

/** D-e3: dismissed only for the exact snapshot the user dismissed. */
export function isDifferenceDismissed(
  account: Pick<Account, 'smsBalanceAt' | 'smsBalanceDismissedAt'>,
): boolean {
  return (
    account.smsBalanceAt != null &&
    account.smsBalanceDismissedAt != null &&
    account.smsBalanceDismissedAt === account.smsBalanceAt
  );
}

export type DifferenceDirection = 'higher' | 'lower' | 'none';

/** Tracker vs bank, as a direction word for the UI. */
export function differenceDirection(diffMinor: number): DifferenceDirection {
  return diffMinor > 0 ? 'higher' : diffMinor < 0 ? 'lower' : 'none';
}

/**
 * D-e2: the Add Record prefill for a difference — amount = |diff|, kind from
 * the sign (tracked < bank -> income; tracked > bank -> expense). null when
 * reconciled. A guess for the user to edit — never an auto-recorded item.
 */
export function prefillForDifference(
  diffMinor: number,
): { type: 'income' | 'expense'; amountMinor: number } | null {
  if (diffMinor === 0) return null;
  return { type: diffMinor < 0 ? 'income' : 'expense', amountMinor: Math.abs(diffMinor) };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * D-g: "as of" copy for the bank SMS time, relative to the injected `now`
 * (the screen's useNow) so it stays live on focus. No date library.
 */
export function formatAsOf(asOfIso: string, now: Date): string {
  const at = Date.parse(asOfIso);
  if (Number.isNaN(at)) return '';
  const ageMs = Math.max(0, now.getTime() - at);
  if (ageMs < MINUTE) return 'just now';
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)} min ago`;
  if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)} h ago`;
  if (ageMs < 2 * DAY) return 'yesterday';
  if (ageMs < 30 * DAY) return `${Math.floor(ageMs / DAY)} days ago`;
  return new Date(at).toLocaleDateString('en-IN');
}
