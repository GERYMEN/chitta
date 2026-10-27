import { Account, AccountType } from './account.types';
import { Transaction } from '../transactions/transaction.types';
import { affectsBalance } from '../transactions/transaction.rules';

/**
 * calculated_balance = anchor + approved_income - approved_expense for
 * approved transactions dated strictly AFTER the balance anchor
 * (docs/PROJECT.md §12). Pending and rejected transactions never affect it.
 *
 * When no anchor is set (both `balanceAnchorMinor` and `balanceAnchorAt`
 * are `null`), the anchor is `openingBalanceMinor` and every transaction
 * counts — byte-identical to the pre-anchor formula for all existing
 * accounts. When an anchor IS set, only transactions dated strictly after
 * `balanceAnchorAt` count, starting from `balanceAnchorMinor`; transactions
 * at or before the anchor are history-only and excluded from the sum here.
 *
 * Credit cards track outstanding liability rather than cash-on-hand: an
 * approved expense increases what's owed, an approved payment/income
 * (e.g. a bill payment) reduces it. The arithmetic is identical — only
 * the interpretation of the sign differs at the UI layer.
 */
export function calculateBalance(
  account: Pick<Account, 'openingBalanceMinor' | 'balanceAnchorMinor' | 'balanceAnchorAt'>,
  transactions: ReadonlyArray<
    Pick<Transaction, 'status' | 'type' | 'amountMinor' | 'accountId' | 'occurredAt'>
  >,
  accountId: string,
): number {
  const anchorMinor = account.balanceAnchorMinor ?? account.openingBalanceMinor;
  const anchorAtMs = account.balanceAnchorAt ? Date.parse(account.balanceAnchorAt) : -Infinity;

  return transactions
    .filter(
      t =>
        t.accountId === accountId &&
        affectsBalance(t) &&
        Date.parse(t.occurredAt) > anchorAtMs,
    )
    .reduce((balance, t) => {
      return t.type === 'income' ? balance + t.amountMinor : balance - t.amountMinor;
    }, anchorMinor);
}

export function isLiabilityAccount(type: AccountType): boolean {
  return type === 'credit_card';
}

/** D10: an account is soft-deleted when `deletedAt` is set. */
export function isDeletedAccount(account: Pick<Account, 'deletedAt'>): boolean {
  return account.deletedAt != null;
}

/** D10: accounts that count toward balances, pickers and SMS matching. */
export function activeAccounts<T extends Pick<Account, 'deletedAt'>>(
  accounts: ReadonlyArray<T>,
): T[] {
  return accounts.filter(account => !isDeletedAccount(account));
}

/** D10: soft-deleted accounts (shown only in the "Deleted accounts" section). */
export function deletedAccounts<T extends Pick<Account, 'deletedAt'>>(
  accounts: ReadonlyArray<T>,
): T[] {
  return accounts.filter(isDeletedAccount);
}

/**
 * Label for the account a transaction belongs to. Single source of truth for
 * every place a transaction's account is shown.
 * - active:   "HDFC Salary ••••1859" (or just the name with no last four)
 * - deleted:  "Deleted account ••1859 (HDFC Salary)" / "Deleted account (Cash)"
 * - missing:  "Unknown"
 */
export function accountDisplayLabel(
  account: Pick<Account, 'name' | 'lastFour' | 'deletedAt'> | null | undefined,
): string {
  if (!account) return 'Unknown';
  if (isDeletedAccount(account)) {
    return account.lastFour
      ? `Deleted account ••${account.lastFour} (${account.name})`
      : `Deleted account (${account.name})`;
  }
  return account.lastFour ? `${account.name} ••••${account.lastFour}` : account.name;
}
