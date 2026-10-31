import { useTransactionsStore } from '../transactions/state/transactionsStore';
import {
  countInboxSince,
  readInboxPage,
  SmsMessage,
} from '../../native/android/sms/smsReader';
import {
  checkSmsPermission,
  requestSmsPermission,
} from '../../native/android/permissions/smsPermission';
import { parseSmsMessage } from './smsParser';
import { Transaction } from '../../domain/transactions/transaction.types';
import {
  autoApproveAfterSync,
  buildSmsTransactionInput,
  filterNewCandidates,
  partitionCandidates,
  resolveCategoryIdForSms,
  SmsAccountSuggestion,
  SuggestionDecisions,
} from './smsSyncLogic';
import {
  accountRepository,
  SuggestionDecisionRow,
} from '../../data/repositories/account.repository';
import { activeAccounts } from '../../domain/accounts/account.rules';
import { UNCATEGORISED_ID } from '../../domain/categories/category.rules';
import { groupUnmatchedCandidates } from './suggestionGroups';
import { useSuggestionSession } from './suggestionSession';
import { ParsedSmsTransaction } from './smsParser';
import {
  computeSyncWindow,
  needsLargeScanConfirm,
  nextLastSyncedAt,
  SMS_PAGE_SIZE,
  SyncWindow,
} from '../../domain/settings/smsSyncStart.rules';
import { firstCursor, isLastPage, nextCursor } from './inboxPaging';

export interface SmsSyncResult {
  scanned: number;
  created: number;
  /** New items from THIS sync that landed in "Uncategorised" (no rule). */
  uncategorised: number;
  skipped: number;
  /** New SMS transactions from THIS sync approved by the opt-in auto mode. */
  autoApproved: number;
  /**
   * R3a: new items the auto rule would have approved but that form a
   * possible transfer pair — left pending for the user to decide.
   */
  heldForTransfer: number;
  /** R3b: new items held from auto-approve because they form a possible duplicate pair. */
  heldForDuplicate: number;
  /** R4b: the user pressed Cancel — items already inserted are kept. */
  cancelled: boolean;
  /** R4b: the user said no to the large-scan warning — nothing was read. */
  declined: boolean;
  suggestions: SmsAccountSuggestion[];
  /**
   * R2b: id of this run's in-memory suggestion session (the groups with
   * their waiting candidates). Nav params carry only this id.
   */
  suggestionRunId: string;
}

/** R2b: 'added'/'linked' rows route a key to an account; 'ignored' drops it. */
export function toSuggestionDecisions(
  rows: ReadonlyArray<SuggestionDecisionRow>,
): SuggestionDecisions {
  const routes = new Map<string, string>();
  const ignored = new Set<string>();
  for (const row of rows) {
    if ((row.decision === 'added' || row.decision === 'linked') && row.accountId) {
      routes.set(row.key, row.accountId);
    } else if (row.decision === 'ignored') {
      ignored.add(row.key);
    }
  }
  return { routes, ignored };
}

export type SmsSyncErrorCode =
  | 'permission-denied'
  | 'permission-permanently-denied'
  | 'no-accounts'
  | 'read-failed';

export class SmsSyncError extends Error {
  readonly code: SmsSyncErrorCode;

  constructor(code: SmsSyncErrorCode, message: string) {
    super(message);
    this.name = 'SmsSyncError';
    this.code = code;
  }
}

export interface SyncProgress {
  scanned: number;
  /** The COUNT estimate taken before the scan (0 if unavailable). */
  total: number;
}

/** R4b: a plain flag the caller flips; checked between pages. */
export interface CancelToken {
  cancelled: boolean;
}

export interface SyncOptions {
  /**
   * Explicit window (Settings "start moved earlier" gap scan). A gap scan
   * never moves `sms_last_synced_at`. Default: the normal sync window.
   */
  window?: SyncWindow;
  onProgress?: (progress: SyncProgress) => void;
  /** Asked when the estimate is above LARGE_SCAN_THRESHOLD; false = no scan. */
  confirmLargeScan?: (estimate: number) => Promise<boolean>;
  cancel?: CancelToken;
  pageSize?: number;
  /** Injected clock (tests). */
  now?: () => number;
}

/** Yield to the JS event loop so the UI can render between pages. */
function yieldToUi(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * R4b: SMS count inside a half-open window, from two COUNT queries
 * (date >= since) − (date >= before). No text is read.
 */
export async function estimateWindowCount(window: SyncWindow): Promise<number> {
  const [fromSince, fromBefore] = await Promise.all([
    countInboxSince(window.sinceMs),
    countInboxSince(window.beforeMs),
  ]);
  return Math.max(0, fromSince - fromBefore);
}

/** R4b: the normal Sync window for the current settings. */
export function currentSyncWindow(nowMs: number = Date.now()): SyncWindow {
  const { smsSyncStartAt, smsLastSyncedAt } = useTransactionsStore.getState();
  return computeSyncWindow({ startAt: smsSyncStartAt, lastSyncedAt: smsLastSyncedAt, nowMs });
}

function emptyResult(declined: boolean): SmsSyncResult {
  return {
    scanned: 0,
    created: 0,
    uncategorised: 0,
    skipped: 0,
    autoApproved: 0,
    heldForTransfer: 0,
    heldForDuplicate: 0,
    cancelled: false,
    declined,
    suggestions: [],
    suggestionRunId: '',
  };
}

/**
 * User-triggered SMS sync. Reads the existing inbox (no background listening)
 * inside a date window, page by page (R4b: no 200-message cap), parses each
 * message with the v1 heuristic parser, dedupes against existing
 * `sourceReferenceHash` values, and creates `pending` transactions. Nothing is
 * auto-approved by default (same Detect -> Review -> Approve -> Record principle
 * as manual entry).
 *
 * R4b window: first sync [start, now]; later syncs from
 * max(start, sms_last_synced_at − 1 day) — dedup by hash prevents doubles.
 * Pages of SMS_PAGE_SIZE, newest first, parsed + inserted per page with a
 * yield in between; raw messages of a page are dropped once parsed (bodies
 * live in memory only during parsing). Cancel (checked between pages) keeps
 * what was inserted and does NOT move `sms_last_synced_at`: pages run newest
 * → oldest, so the cursor only advances once the whole window is processed.
 *
 * Opt-in auto-approve: when the user has chosen approval mode 'auto', each
 * transaction CREATED BY THIS SYNC whose confidence is >= the user's threshold
 * (clamped to 70..100) is approved through the same `store.approve` path a
 * manual approve uses (canTransition pending -> approved). Existing pending
 * items are never retroactively approved, and manual entries never go through
 * this path. R3a: auto-approval runs after ALL new rows are inserted, and a
 * new row that forms a possible transfer pair is never auto-approved (it stays
 * pending for "It's a transfer" / "Not a transfer"). Dedup by
 * sourceReferenceHash is unchanged — a confirmed pair's credit twin keeps its
 * hash, so re-sync never recreates it.
 *
 * Audit (R1): `store.addTransaction` writes one 'detected' event (actor
 * 'system', confidence only — never SMS text/sender/preview) in the same
 * db.transaction as each inserted pending row, and an auto-approval writes
 * one 'auto_approved' event (actor 'system', confidence + threshold) in the
 * same db.transaction as the status change.
 */
export async function syncSms(options: SyncOptions = {}): Promise<SmsSyncResult> {
  const granted = await checkSmsPermission();
  if (!granted) {
    const requested = await requestSmsPermission();
    if (requested === 'never_ask_again') {
      throw new SmsSyncError(
        'permission-permanently-denied',
        'SMS permission was permanently denied',
      );
    }
    if (requested === 'denied') {
      throw new SmsSyncError('permission-denied', 'SMS permission was not granted');
    }
  }

  const store = useTransactionsStore.getState();
  if (activeAccounts(store.accounts).length === 0) {
    throw new SmsSyncError('no-accounts', 'Add an account before syncing SMS');
  }

  const now = options.now ?? Date.now;
  const isGapScan = options.window != null;
  const window = options.window ?? currentSyncWindow(now());
  const pageSize = Math.max(1, options.pageSize ?? SMS_PAGE_SIZE);
  const cancel = options.cancel ?? { cancelled: false };

  let total: number;
  try {
    total = await estimateWindowCount(window);
  } catch (error) {
    throw new SmsSyncError(
      'read-failed',
      error instanceof Error ? error.message : 'Failed to read the SMS inbox',
    );
  }
  if (options.confirmLargeScan && needsLargeScanConfirm(total)) {
    const go = await options.confirmLargeScan(total);
    if (!go) return emptyResult(true);
  }
  options.onProgress?.({ scanned: 0, total });

  const existingHashes = new Set(
    store.transactions
      .map(transaction => transaction.sourceReferenceHash)
      .filter((hash): hash is string => hash != null),
  );

  // D10: SMS owned by a soft-deleted account (exact type+lastFour match, or
  // a 'deleted' decision for its normalized key) are dropped — not imported,
  // not suggested. Active accounts are matched first and always win.
  // R2b: explicit Add/Link decisions route a key to its account; Ignore drops it.
  const deletedDecisionKeys = await accountRepository.listDeletedDecisionKeys();
  const decisions = toSuggestionDecisions(await accountRepository.listSuggestionDecisions());

  // Snapshot the policy once so a settings change mid-sync can't mix modes.
  const { approvalMode, autoApproveThreshold } = store;

  let scanned = 0;
  let uncategorised = 0;
  let newestSeenMs: number | null = null;
  let completed = false;
  const createdRows: Transaction[] = [];
  const unmatchedAll: ParsedSmsTransaction[] = [];
  let cursor = firstCursor(window);

  while (!cancel.cancelled) {
    let page: SmsMessage[];
    try {
      page = await readInboxPage(window.sinceMs, cursor.beforeMs, cursor.beforeId, pageSize);
    } catch (error) {
      throw new SmsSyncError(
        'read-failed',
        error instanceof Error ? error.message : 'Failed to read the SMS inbox',
      );
    }
    if (newestSeenMs == null && page.length > 0) newestSeenMs = page[0].date;

    const candidates = page
      .map(message => parseSmsMessage(message))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null);
    const fresh = filterNewCandidates(candidates, existingHashes);
    for (const candidate of fresh) existingHashes.add(candidate.sourceReferenceHash);

    const latestStore = useTransactionsStore.getState();
    const { matched, unmatched } = partitionCandidates(
      fresh,
      latestStore.accounts,
      deletedDecisionKeys,
      decisions,
    );
    unmatchedAll.push(...unmatched);

    for (const { parsed, accountId } of matched) {
      // R2: merchant rule first, else the system "Uncategorised" bucket.
      const categoryId = resolveCategoryIdForSms(
        latestStore.categories,
        parsed.type,
        parsed.merchantName,
        latestStore.merchantRules,
      );
      if (categoryId == null) continue;

      const input = buildSmsTransactionInput(parsed, accountId, categoryId, new Date().toISOString());

      createdRows.push(await useTransactionsStore.getState().addTransaction(input));
      if (categoryId === UNCATEGORISED_ID) uncategorised++;
    }

    scanned += page.length;
    options.onProgress?.({ scanned, total });
    const last = isLastPage(page.length, pageSize);
    cursor = nextCursor(page, cursor);
    // The raw page (address/body) goes out of scope here.
    if (last) {
      completed = true;
      break;
    }
    await yieldToUi();
  }
  const created = createdRows.length;

  // R3a T4: auto-approve only AFTER every new pending item is in, so a new
  // item that pairs as a possible transfer stays pending for the user.
  const latest = useTransactionsStore.getState();
  const { approve: toApprove, heldForTransfer, heldForDuplicate } = autoApproveAfterSync(
    createdRows,
    latest.transactions,
    latest.accounts,
    latest.transferDismissals,
    approvalMode,
    autoApproveThreshold,
    latest.duplicateDismissals,
  );
  let autoApproved = 0;
  for (const transaction of toApprove) {
    await useTransactionsStore.getState().approve(transaction.id, {
      confidence: transaction.confidenceScore ?? 0,
      threshold: autoApproveThreshold,
    });
    const after = useTransactionsStore
      .getState()
      .transactions.find(t => t.id === transaction.id);
    if (after?.status === 'approved') autoApproved++;
  }

  // R4b: the cursor moves only when a normal sync processed its whole window.
  if (completed && !isGapScan) {
    const previous = useTransactionsStore.getState().smsLastSyncedAt;
    const next = nextLastSyncedAt(previous, newestSeenMs);
    if (next != null && next !== previous) {
      await useTransactionsStore.getState().setSmsLastSyncedAt(next);
    }
  }

  // R2b: keep each suggestion's waiting candidates in the in-memory session
  // (not nav params, not the DB) so New Accounts Found can show them.
  const groups = groupUnmatchedCandidates(unmatchedAll);
  const suggestionRunId = useSuggestionSession.getState().start(groups);
  const suggestions = groups.map(group => ({ ...group.suggestion }));
  return {
    scanned,
    created,
    uncategorised,
    skipped: scanned - created,
    autoApproved,
    heldForTransfer: heldForTransfer.length,
    heldForDuplicate: heldForDuplicate.length,
    cancelled: !completed,
    declined: false,
    suggestions,
    suggestionRunId,
  };
}
