import { Account } from '../accounts/account.types';
import { isDeletedAccount } from '../accounts/account.rules';
import { TRANSFER_CATEGORY_ID } from '../categories/category.rules';
import {
  LinkKind,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/transaction.types';

/**
 * R3a — transfers between the owner's own accounts. Pure rules only (no
 * React, no store, no SQL); every screen and the sync path call these.
 */

export const TRANSFER_PAIR_WINDOW_HOURS = 24;

/** "Not a transfer" — a pair the user rejected; never suggested again. */
export interface TransferDismissal {
  debitId: string;
  creditId: string;
  dismissedAt: string;
}

/** A suggested pair: an expense on A + an income of the same amount on B. */
export interface TransferPair {
  debit: Transaction;
  credit: Transaction;
  /** |credit.occurredAt − debit.occurredAt| in ms. */
  diffMs: number;
}

export function transferPairKey(debitId: string, creditId: string): string {
  return `${debitId}|${creditId}`;
}

const PAIRABLE_STATUSES: ReadonlySet<TransactionStatus> = new Set(['pending', 'approved']);

/** A row that may take part in a suggested pair (either side). */
export function isPairCandidate(
  t: Pick<Transaction, 'type' | 'status'> &
    Partial<Pick<Transaction, 'linkKind' | 'linkedTransactionId' | 'transferAccountId'>>,
): boolean {
  if (t.type !== 'income' && t.type !== 'expense') return false;
  if (!PAIRABLE_STATUSES.has(t.status)) return false;
  if (t.linkKind != null || t.linkedTransactionId != null) return false;
  return t.transferAccountId == null;
}

/**
 * Pairs = one expense on own account A + one income of the EXACT same amount
 * (paise) on own account B, A ≠ B, both accounts active (not soft-deleted),
 * |occurredAt diff| ≤ window (inclusive), both rows pending or approved,
 * neither already a transfer / linked / rejected, and the pair not dismissed.
 *
 * Each row is in at most one pair: all candidate pairs are ranked by time
 * difference (closest first); a tie goes to the pair whose earlier row
 * happened first, then the earlier debit, then ids (deterministic). Pairs are
 * taken greedily in that order, skipping any whose rows are already used.
 * Result is ordered newest debit first (display order).
 */
export function findTransferPairs(
  transactions: ReadonlyArray<Transaction>,
  accounts: ReadonlyArray<Pick<Account, 'id' | 'deletedAt'>>,
  dismissals: ReadonlyArray<Pick<TransferDismissal, 'debitId' | 'creditId'>>,
  windowHours: number = TRANSFER_PAIR_WINDOW_HOURS,
): TransferPair[] {
  const windowMs = windowHours * 60 * 60 * 1000;
  const active = new Set(accounts.filter(a => !isDeletedAccount(a)).map(a => a.id));
  const dismissed = new Set(dismissals.map(d => transferPairKey(d.debitId, d.creditId)));

  const usable = transactions.filter(
    t => isPairCandidate(t) && active.has(t.accountId) && Number.isFinite(Date.parse(t.occurredAt)),
  );
  const incomesByAmount = new Map<number, Transaction[]>();
  for (const t of usable) {
    if (t.type !== 'income') continue;
    const list = incomesByAmount.get(t.amountMinor);
    if (list) list.push(t);
    else incomesByAmount.set(t.amountMinor, [t]);
  }

  interface Candidate extends TransferPair {
    earliestMs: number;
    debitMs: number;
  }
  const candidates: Candidate[] = [];
  for (const debit of usable) {
    if (debit.type !== 'expense') continue;
    const debitMs = Date.parse(debit.occurredAt);
    for (const credit of incomesByAmount.get(debit.amountMinor) ?? []) {
      if (credit.accountId === debit.accountId) continue;
      const creditMs = Date.parse(credit.occurredAt);
      const diffMs = Math.abs(creditMs - debitMs);
      if (diffMs > windowMs) continue;
      if (dismissed.has(transferPairKey(debit.id, credit.id))) continue;
      candidates.push({
        debit,
        credit,
        diffMs,
        earliestMs: Math.min(debitMs, creditMs),
        debitMs,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      a.diffMs - b.diffMs ||
      a.earliestMs - b.earliestMs ||
      a.debitMs - b.debitMs ||
      compareIds(a.debit.id, b.debit.id) ||
      compareIds(a.credit.id, b.credit.id),
  );

  const used = new Set<string>();
  const pairs: Candidate[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.debit.id) || used.has(candidate.credit.id)) continue;
    used.add(candidate.debit.id);
    used.add(candidate.credit.id);
    pairs.push(candidate);
  }

  return pairs
    .sort((a, b) => b.debitMs - a.debitMs || compareIds(a.debit.id, b.debit.id))
    .map(({ debit, credit, diffMs }) => ({ debit, credit, diffMs }));
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ids of rows that are part of any suggested pair. */
export function pairedTransactionIds(pairs: ReadonlyArray<TransferPair>): Set<string> {
  const ids = new Set<string>();
  for (const pair of pairs) {
    ids.add(pair.debit.id);
    ids.add(pair.credit.id);
  }
  return ids;
}

/** The fields a pair confirmation changes — stored so Undo restores them exactly. */
export interface TransferRowSnapshot {
  type: TransactionType;
  status: TransactionStatus;
  categoryId: string;
  approvedAt: string | null;
  transferAccountId: string | null;
  linkedTransactionId: string | null;
  linkKind: LinkKind | null;
}

export interface TransferPairPrevious {
  debit: TransferRowSnapshot;
  credit: TransferRowSnapshot;
}

export function snapshotTransferRow(t: Transaction): TransferRowSnapshot {
  return {
    type: t.type,
    status: t.status,
    categoryId: t.categoryId,
    approvedAt: t.approvedAt,
    transferAccountId: t.transferAccountId ?? null,
    linkedTransactionId: t.linkedTransactionId ?? null,
    linkKind: t.linkKind ?? null,
  };
}

function applySnapshot(t: Transaction, snapshot: TransferRowSnapshot, now: string): Transaction {
  return { ...t, ...snapshot, updatedAt: now };
}

export interface PairConfirmation {
  debit: Transaction;
  credit: Transaction;
  previous: TransferPairPrevious;
}

/**
 * "It's a transfer": the debit row BECOMES the transfer (type 'transfer',
 * to = the credit's account, category cat-transfer, approved). The credit row
 * is kept (its sourceReferenceHash stops re-sync recreating it) as status
 * 'rejected', link_kind 'transfer_twin', linked to the debit — so it is in no
 * list, total or balance. Null when the two rows are no longer a valid pair.
 */
export function confirmTransferPair(
  debit: Transaction,
  credit: Transaction,
  now: string,
): PairConfirmation | null {
  if (debit.type !== 'expense' || credit.type !== 'income') return null;
  if (!isPairCandidate(debit) || !isPairCandidate(credit)) return null;
  if (debit.accountId === credit.accountId || debit.amountMinor !== credit.amountMinor) return null;
  return {
    previous: { debit: snapshotTransferRow(debit), credit: snapshotTransferRow(credit) },
    debit: {
      ...debit,
      type: 'transfer',
      transferAccountId: credit.accountId,
      categoryId: TRANSFER_CATEGORY_ID,
      status: 'approved',
      approvedAt: debit.status === 'approved' && debit.approvedAt ? debit.approvedAt : now,
      linkedTransactionId: null,
      linkKind: null,
      updatedAt: now,
    },
    credit: {
      ...credit,
      status: 'rejected',
      linkKind: 'transfer_twin',
      linkedTransactionId: debit.id,
      updatedAt: now,
    },
  };
}

/**
 * "Undo transfer": restore both rows' saved fields exactly (updatedAt = now).
 * Null when the rows are not (any more) this confirmed pair.
 */
export function undoTransferPair(
  debit: Transaction,
  credit: Transaction,
  previous: TransferPairPrevious,
  now: string,
): { debit: Transaction; credit: Transaction } | null {
  if (debit.type !== 'transfer') return null;
  if (credit.linkKind !== 'transfer_twin' || credit.linkedTransactionId !== debit.id) return null;
  return {
    debit: applySnapshot(debit, previous.debit, now),
    credit: applySnapshot(credit, previous.credit, now),
  };
}

/** The kept SMS twin of a confirmed transfer, if this transfer was paired. */
export function findTransferTwin<T extends Pick<Transaction, 'linkKind' | 'linkedTransactionId'>>(
  transactions: ReadonlyArray<T>,
  transferId: string,
): T | null {
  return (
    transactions.find(t => t.linkKind === 'transfer_twin' && t.linkedTransactionId === transferId) ??
    null
  );
}

/** True when a row is on this account — either side of a transfer. */
export function touchesAccount(
  t: Pick<Transaction, 'accountId'> & Partial<Pick<Transaction, 'type' | 'transferAccountId'>>,
  accountId: string,
): boolean {
  return t.accountId === accountId || (t.type === 'transfer' && t.transferAccountId === accountId);
}

/** Per-account view of a transfer: money left this account ('out') or arrived ('in'). */
export function transferDirection(
  t: Pick<Transaction, 'type' | 'accountId'> & Partial<Pick<Transaction, 'transferAccountId'>>,
  accountId: string,
): 'out' | 'in' | null {
  if (t.type !== 'transfer') return null;
  if (t.accountId === accountId) return 'out';
  if (t.transferAccountId === accountId) return 'in';
  return null;
}

export type MarkAsTransferPatch = Pick<
  Transaction,
  'type' | 'accountId' | 'transferAccountId' | 'categoryId'
>;

/**
 * "Mark as transfer" on an approved income/expense. Expense on A: the user
 * picks where it went ("to") → from A to B. Income on A: the user picks where
 * it came from ("from") → from B to A. Null when not allowed (not approved,
 * already a transfer/linked, or the same account).
 */
export function markAsTransferPatch(
  t: Transaction,
  otherAccountId: string,
): MarkAsTransferPatch | null {
  if (t.status !== 'approved' || !isPairCandidate(t)) return null;
  if (otherAccountId === t.accountId || otherAccountId === '') return null;
  return t.type === 'expense'
    ? {
        type: 'transfer',
        accountId: t.accountId,
        transferAccountId: otherAccountId,
        categoryId: TRANSFER_CATEGORY_ID,
      }
    : {
        type: 'transfer',
        accountId: otherAccountId,
        transferAccountId: t.accountId,
        categoryId: TRANSFER_CATEGORY_ID,
      };
}

/** Default merchant text of a manual transfer (the row needs one; notes hold the user's text). */
export const MANUAL_TRANSFER_TITLE = 'Transfer';
