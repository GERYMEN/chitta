import { Transaction, TransactionStatus } from '../transactions/transaction.types';
import { snapshotTransferRow, TransferRowSnapshot } from '../transfers/transfer.rules';

/**
 * R3b — the same money recorded twice. Pure rules only (no React, no store,
 * no SQL). Marking keeps one row and hides the other exactly like an R3a
 * transfer twin: status 'rejected', link_kind 'duplicate',
 * linked_transaction_id = the kept row. The hidden row keeps its
 * sourceReferenceHash, so SMS re-sync never recreates it.
 */

export const DUPLICATE_WINDOW_MINUTES = 10;
/** Manual "Mark as duplicate of…" looks this far either side. */
export const DUPLICATE_PICKER_DAYS = 3;

const LIVE_STATUSES: ReadonlySet<TransactionStatus> = new Set(['pending', 'approved']);

/** "Not duplicates": a_id < b_id (one row per unordered pair). */
export interface DuplicateDismissal {
  aId: string;
  bId: string;
  dismissedAt: string;
}

export interface DuplicatePair {
  /** The earlier row (by occurredAt, then id). */
  first: Transaction;
  second: Transaction;
  /** |second.occurredAt − first.occurredAt| in ms. */
  diffMs: number;
}

/** Ordered key for an unordered pair: [smaller id, larger id]. */
export function orderedPairIds(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export function duplicatePairKey(x: string, y: string): string {
  const [a, b] = orderedPairIds(x, y);
  return `${a}|${b}`;
}

/** A row that may be one side of a duplicate pair. */
export function isDuplicateCandidate(
  t: Pick<Transaction, 'type' | 'status'> &
    Partial<Pick<Transaction, 'linkKind' | 'linkedTransactionId' | 'transferAccountId'>>,
): boolean {
  if (t.type !== 'income' && t.type !== 'expense') return false;
  if (!LIVE_STATUSES.has(t.status)) return false;
  if (t.linkKind != null || t.linkedTransactionId != null) return false;
  return t.transferAccountId == null;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Suggested duplicate pairs: same account, same type (income/expense only),
 * same amount (paise), |occurredAt diff| ≤ window (inclusive), both pending
 * or approved, neither linked/transfer/rejected, pair not dismissed. Each row
 * is in at most one pair: closest pairs are taken first (tie → earlier
 * first row, then ids). Result is ordered newest pair first.
 */
export function findDuplicatePairs(
  transactions: ReadonlyArray<Transaction>,
  dismissals: ReadonlyArray<Pick<DuplicateDismissal, 'aId' | 'bId'>>,
  windowMinutes: number = DUPLICATE_WINDOW_MINUTES,
): DuplicatePair[] {
  const windowMs = windowMinutes * 60 * 1000;
  const dismissed = new Set(dismissals.map(d => duplicatePairKey(d.aId, d.bId)));

  const groups = new Map<string, Array<{ t: Transaction; ms: number }>>();
  for (const t of transactions) {
    if (!isDuplicateCandidate(t)) continue;
    const ms = Date.parse(t.occurredAt);
    if (!Number.isFinite(ms)) continue;
    const key = `${t.accountId}|${t.type}|${t.amountMinor}`;
    const list = groups.get(key);
    if (list) list.push({ t, ms });
    else groups.set(key, [{ t, ms }]);
  }

  interface Candidate extends DuplicatePair {
    firstMs: number;
  }
  const candidates: Candidate[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.ms - b.ms || compareIds(a.t.id, b.t.id));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const diffMs = list[j].ms - list[i].ms;
        if (diffMs > windowMs) break;
        if (dismissed.has(duplicatePairKey(list[i].t.id, list[j].t.id))) continue;
        candidates.push({ first: list[i].t, second: list[j].t, diffMs, firstMs: list[i].ms });
      }
    }
  }

  candidates.sort(
    (a, b) =>
      a.diffMs - b.diffMs ||
      a.firstMs - b.firstMs ||
      compareIds(a.first.id, b.first.id) ||
      compareIds(a.second.id, b.second.id),
  );

  const used = new Set<string>();
  const pairs: Candidate[] = [];
  for (const c of candidates) {
    if (used.has(c.first.id) || used.has(c.second.id)) continue;
    used.add(c.first.id);
    used.add(c.second.id);
    pairs.push(c);
  }
  return pairs
    .sort((a, b) => b.firstMs - a.firstMs || compareIds(a.first.id, b.first.id))
    .map(({ first, second, diffMs }) => ({ first, second, diffMs }));
}

/** Ids of rows that are part of any suggested duplicate pair. */
export function duplicatePairIds(pairs: ReadonlyArray<DuplicatePair>): Set<string> {
  const ids = new Set<string>();
  for (const p of pairs) {
    ids.add(p.first.id);
    ids.add(p.second.id);
  }
  return ids;
}

/** Default row to KEEP: the approved one, else the earlier one. */
export function defaultKeepId(pair: Pick<DuplicatePair, 'first' | 'second'>): string {
  const firstApproved = pair.first.status === 'approved';
  const secondApproved = pair.second.status === 'approved';
  if (secondApproved && !firstApproved) return pair.second.id;
  return pair.first.id;
}

/**
 * Manual "Mark as duplicate of…" choices for `t`: other pending/approved
 * rows with the same account + type + amount within DUPLICATE_PICKER_DAYS,
 * not linked/transfer. Closest in time first.
 */
export function duplicatePickerOptions(
  t: Transaction,
  transactions: ReadonlyArray<Transaction>,
  days: number = DUPLICATE_PICKER_DAYS,
): Transaction[] {
  if (!isDuplicateCandidate(t)) return [];
  const ms = Date.parse(t.occurredAt);
  if (!Number.isFinite(ms)) return [];
  const windowMs = days * 24 * 60 * 60 * 1000;
  return transactions
    .filter(
      other =>
        other.id !== t.id &&
        isDuplicateCandidate(other) &&
        other.accountId === t.accountId &&
        other.type === t.type &&
        other.amountMinor === t.amountMinor &&
        Math.abs(Date.parse(other.occurredAt) - ms) <= windowMs,
    )
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.occurredAt) - ms) - Math.abs(Date.parse(b.occurredAt) - ms) ||
        compareIds(a.id, b.id),
    );
}

/** Saved before marking so "Not a duplicate" restores the hidden row EXACTLY. */
export type DuplicateRowSnapshot = TransferRowSnapshot;

export interface DuplicateMarking {
  /** The hidden row after marking (the kept row is not changed). */
  duplicate: Transaction;
  previous: DuplicateRowSnapshot;
}

/**
 * Mark `duplicate` as a duplicate of `kept`: it becomes status 'rejected',
 * link_kind 'duplicate', linked to the kept row (a system rule outside
 * canTransition, like the R3a twin). Null when the two rows are not a valid
 * pair (same account + type + amount, both candidates, different rows).
 */
export function markDuplicate(
  kept: Transaction,
  duplicate: Transaction,
  now: string,
): DuplicateMarking | null {
  if (kept.id === duplicate.id) return null;
  if (!isDuplicateCandidate(kept) || !isDuplicateCandidate(duplicate)) return null;
  if (
    kept.accountId !== duplicate.accountId ||
    kept.type !== duplicate.type ||
    kept.amountMinor !== duplicate.amountMinor
  ) {
    return null;
  }
  return {
    previous: snapshotTransferRow(duplicate),
    duplicate: {
      ...duplicate,
      status: 'rejected',
      linkKind: 'duplicate',
      linkedTransactionId: kept.id,
      updatedAt: now,
    },
  };
}

/** "Not a duplicate": restore the saved fields exactly. Null when not a hidden duplicate. */
export function restoreDuplicate(
  hidden: Transaction,
  previous: DuplicateRowSnapshot,
  now: string,
): Transaction | null {
  if (hidden.linkKind !== 'duplicate' || hidden.linkedTransactionId == null) return null;
  return { ...hidden, ...previous, updatedAt: now };
}

/** Hidden duplicates that point at this kept row. */
export function hiddenDuplicatesOf<T extends Pick<Transaction, 'linkKind' | 'linkedTransactionId'>>(
  transactions: ReadonlyArray<T>,
  keptId: string,
): T[] {
  return transactions.filter(t => t.linkKind === 'duplicate' && t.linkedTransactionId === keptId);
}
