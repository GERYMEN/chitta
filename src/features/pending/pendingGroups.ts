import { Account } from '../../domain/accounts/account.types';
import { accountDisplayLabel } from '../../domain/accounts/account.rules';
import { Transaction } from '../../domain/transactions/transaction.types';
import {
  ApprovalMode,
  clampThreshold,
  shouldAutoApprove,
  shouldShowThresholdNote,
  thresholdNoteText,
} from '../../domain/settings/approval.rules';

export interface PendingSection {
  accountId: string;
  /** "<accountDisplayLabel> · N pending" (deleted accounts labelled by the helper). */
  title: string;
  data: Transaction[];
}

/**
 * R2b: group pending items by account. Items newest first; sections ordered
 * by their newest item (the account with the latest activity on top).
 */
export function groupPendingByAccount(
  pending: ReadonlyArray<Transaction>,
  accounts: ReadonlyArray<Account>,
): PendingSection[] {
  const byAccount = new Map<string, Transaction[]>();
  const sorted = [...pending].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );
  for (const transaction of sorted) {
    const list = byAccount.get(transaction.accountId);
    if (list) list.push(transaction);
    else byAccount.set(transaction.accountId, [transaction]);
  }
  return Array.from(byAccount.entries()).map(([accountId, data]) => ({
    accountId,
    title: pendingSectionTitle(accounts.find(account => account.id === accountId), data.length),
    data,
  }));
}

export function pendingSectionTitle(account: Account | undefined, count: number): string {
  return `${accountDisplayLabel(account)} · ${count} pending`;
}

/**
 * Pending items the Auto-approve button would approve: SMS items that the
 * single auto-approve rule (`shouldAutoApprove`) accepts.
 */
export function autoApproveEligible(
  pending: ReadonlyArray<Transaction>,
  mode: ApprovalMode,
  threshold: number,
): Transaction[] {
  return pending.filter(
    t =>
      t.status === 'pending' &&
      t.sourceType === 'sms' &&
      shouldAutoApprove(mode, threshold, t.confidenceScore),
  );
}

export interface AutoApproveButtonState {
  /** Hidden in manual mode. */
  visible: boolean;
  count: number;
  disabled: boolean;
  /** Shown under a disabled button. */
  hint: string | null;
  /** Clamped threshold, for the label / dialog copy. */
  threshold: number;
}

export function autoApproveButtonState(
  mode: ApprovalMode,
  threshold: number,
  pending: ReadonlyArray<Transaction>,
): AutoApproveButtonState {
  const clamped = clampThreshold(threshold);
  if (mode !== 'auto') {
    return { visible: false, count: 0, disabled: true, hint: null, threshold: clamped };
  }
  const count = autoApproveEligible(pending, mode, threshold).length;
  if (count > 0) {
    return { visible: true, count, disabled: false, hint: null, threshold: clamped };
  }
  const hint = shouldShowThresholdNote(mode, threshold)
    ? thresholdNoteText()
    : `No items at or above ${clamped}%`;
  return { visible: true, count: 0, disabled: true, hint, threshold: clamped };
}

export function autoApproveConfirmTitle(count: number, threshold: number): string {
  return `Approve ${count} transaction${count === 1 ? '' : 's'} at or above ${threshold}% confidence?`;
}
