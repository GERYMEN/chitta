import { Account } from '../../domain/accounts/account.types';
import { accountDisplayLabel } from '../../domain/accounts/account.rules';
import { Transaction } from '../../domain/transactions/transaction.types';
import {
  findTransferPairs,
  pairedTransactionIds,
  TransferDismissal,
} from '../../domain/transfers/transfer.rules';
import {
  DuplicateDismissal,
  duplicatePairIds,
  findDuplicatePairs,
} from '../../domain/duplicates/duplicate.rules';
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

/**
 * R4b: what Pending "Approve all N" approves — the VISIBLE pending items
 * (current type + account filter) that are NOT part of a possible transfer
 * or duplicate pair (those wait for "It's a transfer" / "Not duplicates").
 * Pairs are found over ALL transactions, so a visible item whose twin is
 * filtered out is still excluded.
 */
export function approveAllEligible(
  visible: ReadonlyArray<Transaction>,
  allTransactions: ReadonlyArray<Transaction>,
  accounts: ReadonlyArray<Pick<Account, 'id' | 'deletedAt'>>,
  transferDismissals: ReadonlyArray<Pick<TransferDismissal, 'debitId' | 'creditId'>>,
  duplicateDismissals: ReadonlyArray<Pick<DuplicateDismissal, 'aId' | 'bId'>>,
): Transaction[] {
  const pending = visible.filter(t => t.status === 'pending');
  if (pending.length === 0) return [];
  const paired = pairedTransactionIds(
    findTransferPairs(allTransactions, accounts, transferDismissals),
  );
  const duplicates = duplicatePairIds(findDuplicatePairs(allTransactions, duplicateDismissals));
  return pending.filter(t => !paired.has(t.id) && !duplicates.has(t.id));
}

export function approveAllConfirmTitle(count: number): string {
  return `Approve all ${count} item${count === 1 ? '' : 's'}?`;
}

export function approvedSnackbarText(count: number): string {
  return `Approved ${count}`;
}
