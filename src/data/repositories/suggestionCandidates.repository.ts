import { getDatabase } from '../db/connection';
import type { AccountType } from '../../domain/accounts/account.types';
import { ACCOUNT_KEY_NORMALIZER_VERSION } from '../../features/sms-sync/normalizeAccountKey';

/**
 * R5-fix C2 — persisted "New accounts found" summary (table
 * account_suggestion_candidates, schema since v0, already in backups).
 *
 * One row per undecided account key that a sync saw with no account: the
 * public bank id, kind, last-4, a count and the first/last SMS date. NO SMS
 * content, no amounts, no payees. When the user opens the entry, the app
 * re-reads [first_seen, now] from the inbox (a gap scan — the cursor does not
 * move) to rebuild the cards, so nothing is lost once auto-read moves the
 * sync cursor past those SMS.
 */
export interface SuggestionCandidateRow {
  bankCanonical: string;
  accountKind: AccountType;
  /** '' when none. */
  lastFour: string;
  txnCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export function candidateKey(row: Pick<SuggestionCandidateRow, 'bankCanonical' | 'accountKind' | 'lastFour'>): string {
  return `${row.bankCanonical}:${row.accountKind}:${row.lastFour}`;
}

function toRow(row: Record<string, unknown>): SuggestionCandidateRow {
  return {
    bankCanonical: String(row.bank_canonical),
    accountKind: String(row.account_kind) as AccountType,
    lastFour: row.last_four == null ? '' : String(row.last_four),
    txnCount: Number(row.txn_count ?? 0),
    firstSeenAt: Number(row.first_seen_at ?? 0),
    lastSeenAt: Number(row.last_seen_at ?? 0),
  };
}

async function list(): Promise<SuggestionCandidateRow[]> {
  const result = await getDatabase().execute('SELECT * FROM account_suggestion_candidates');
  return result.rows.map(row => toRow(row as Record<string, unknown>));
}

/** A run's unmatched group, summarised (counts + dates only). */
export interface RunCandidate {
  bankCanonical: string;
  accountKind: AccountType;
  lastFour: string;
  /** SMS dates (ms) of the group's items. */
  dates: ReadonlyArray<number>;
}

/**
 * Pure merge of a scan of `window` into the stored rows:
 *  - a stored key the COMPLETED scan fully covered and did not see again is
 *    gone (an account now matches it, or a decision was made);
 *  - a key seen again keeps the earliest first-seen; its count is replaced
 *    when the scan covered the stored range, else only newer items are added.
 */
export function mergeCandidates(
  stored: ReadonlyArray<SuggestionCandidateRow>,
  run: ReadonlyArray<RunCandidate>,
  window: { sinceMs: number; beforeMs: number },
  completed: boolean,
): { upsert: SuggestionCandidateRow[]; remove: SuggestionCandidateRow[] } {
  const byKey = new Map(stored.map(row => [candidateKey(row), row]));
  const seen = new Set<string>();
  const upsert: SuggestionCandidateRow[] = [];
  for (const group of run) {
    if (group.dates.length === 0) continue;
    const key = candidateKey(group);
    seen.add(key);
    const first = Math.min(...group.dates);
    const last = Math.max(...group.dates);
    const old = byKey.get(key);
    if (!old) {
      upsert.push({ ...group, txnCount: group.dates.length, firstSeenAt: first, lastSeenAt: last });
      continue;
    }
    const covered = window.sinceMs <= old.firstSeenAt;
    upsert.push({
      bankCanonical: group.bankCanonical,
      accountKind: group.accountKind,
      lastFour: group.lastFour,
      txnCount: covered ? group.dates.length : old.txnCount + group.dates.filter(d => d > old.lastSeenAt).length,
      firstSeenAt: Math.min(old.firstSeenAt, first),
      lastSeenAt: Math.max(old.lastSeenAt, last),
    });
  }
  const remove = completed
    ? stored.filter(
        row =>
          !seen.has(candidateKey(row)) &&
          row.firstSeenAt >= window.sinceMs &&
          row.lastSeenAt < window.beforeMs,
      )
    : [];
  return { upsert, remove };
}

const DELETE_SQL =
  'DELETE FROM account_suggestion_candidates WHERE bank_canonical = ? AND account_kind = ? AND last_four = ?';

/** Apply a scan's unmatched groups (one transaction). */
async function recordRun(
  run: ReadonlyArray<RunCandidate>,
  window: { sinceMs: number; beforeMs: number },
  completed: boolean,
): Promise<void> {
  const stored = await list();
  const { upsert, remove } = mergeCandidates(stored, run, window, completed);
  if (upsert.length === 0 && remove.length === 0) return;
  await getDatabase().transaction(async tx => {
    for (const row of remove) {
      await tx.execute(DELETE_SQL, [row.bankCanonical, row.accountKind, row.lastFour]);
    }
    for (const row of upsert) {
      await tx.execute(
        'INSERT OR REPLACE INTO account_suggestion_candidates (bank_canonical, account_kind, last_four, txn_count, first_seen_at, last_seen_at, normalizer_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          row.bankCanonical,
          row.accountKind,
          row.lastFour,
          row.txnCount,
          row.firstSeenAt,
          row.lastSeenAt,
          ACCOUNT_KEY_NORMALIZER_VERSION,
        ],
      );
    }
  });
}

/** Drop every stored row (nothing left to review). */
async function clear(rows: ReadonlyArray<SuggestionCandidateRow>): Promise<void> {
  if (rows.length === 0) return;
  await getDatabase().transaction(async tx => {
    for (const row of rows) await tx.execute(DELETE_SQL, [row.bankCanonical, row.accountKind, row.lastFour]);
  });
}

export const suggestionCandidatesRepository = { list, recordRun, clear, DELETE_SQL };
