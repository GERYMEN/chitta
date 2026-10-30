import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { readInbox } from '../../native/android/sms/smsReader';
import {
  checkSmsPermission,
  requestSmsPermission,
} from '../../native/android/permissions/smsPermission';
import { parseSmsMessage } from './smsParser';
import { shouldAutoApprove } from '../../domain/settings/approval.rules';
import {
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

export interface SmsSyncResult {
  scanned: number;
  created: number;
  /** New items from THIS sync that landed in "Uncategorised" (no rule). */
  uncategorised: number;
  skipped: number;
  /** New SMS transactions from THIS sync approved by the opt-in auto mode. */
  autoApproved: number;
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

const INBOX_LIMIT = 200;

/**
 * User-triggered SMS sync. Reads the existing inbox (no background listening),
 * parses each message with the v1 heuristic parser, dedupes against existing
 * `sourceReferenceHash` values, and creates `pending` transactions. Nothing is
 * auto-approved by default (same Detect -> Review -> Approve -> Record principle
 * as manual entry).
 *
 * Opt-in auto-approve: when the user has chosen approval mode 'auto', each
 * transaction CREATED BY THIS SYNC whose confidence is >= the user's threshold
 * (clamped to 70..100) is approved through the same `store.approve` path a
 * manual approve uses (canTransition pending -> approved). Existing pending
 * items are never retroactively approved, and manual entries never go through
 * this path.
 *
 * Audit (R1): `store.addTransaction` writes one 'detected' event (actor
 * 'system', confidence only — never SMS text/sender/preview) in the same
 * db.transaction as each inserted pending row, and an auto-approval writes
 * one 'auto_approved' event (actor 'system', confidence + threshold) in the
 * same db.transaction as the status change.
 */
export async function syncSms(): Promise<SmsSyncResult> {
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

  let messages;
  try {
    messages = await readInbox(INBOX_LIMIT);
  } catch (error) {
    throw new SmsSyncError(
      'read-failed',
      error instanceof Error ? error.message : 'Failed to read the SMS inbox',
    );
  }

  const existingHashes = new Set(
    store.transactions
      .map(transaction => transaction.sourceReferenceHash)
      .filter((hash): hash is string => hash != null),
  );

  const candidates = messages
    .map(message => parseSmsMessage(message))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null);

  const fresh = filterNewCandidates(candidates, existingHashes);

  // D10: SMS owned by a soft-deleted account (exact type+lastFour match, or
  // a 'deleted' decision for its normalized key) are dropped — not imported,
  // not suggested. Active accounts are matched first and always win.
  // R2b: explicit Add/Link decisions route a key to its account; Ignore drops it.
  const deletedDecisionKeys = await accountRepository.listDeletedDecisionKeys();
  const decisions = toSuggestionDecisions(await accountRepository.listSuggestionDecisions());
  const { matched, unmatched } = partitionCandidates(
    fresh,
    store.accounts,
    deletedDecisionKeys,
    decisions,
  );

  // Snapshot the policy once so a settings change mid-sync can't mix modes.
  const { approvalMode, autoApproveThreshold } = store;

  let created = 0;
  let uncategorised = 0;
  let autoApproved = 0;
  for (const { parsed, accountId } of matched) {
    // R2: merchant rule first, else the system "Uncategorised" bucket.
    const categoryId = resolveCategoryIdForSms(
      store.categories,
      parsed.type,
      parsed.merchantName,
      store.merchantRules,
    );
    if (categoryId == null) continue;

    const input = buildSmsTransactionInput(parsed, accountId, categoryId, new Date().toISOString());

    const createdTransaction = await useTransactionsStore.getState().addTransaction(input);
    created++;
    if (categoryId === UNCATEGORISED_ID) uncategorised++;

    if (
      shouldAutoApprove(approvalMode, autoApproveThreshold, createdTransaction.confidenceScore)
    ) {
      await useTransactionsStore.getState().approve(createdTransaction.id, {
        confidence: createdTransaction.confidenceScore ?? 0,
        threshold: autoApproveThreshold,
      });
      const after = useTransactionsStore
        .getState()
        .transactions.find(t => t.id === createdTransaction.id);
      if (after?.status === 'approved') autoApproved++;
    }
  }

  // R2b: keep each suggestion's waiting candidates in the in-memory session
  // (not nav params, not the DB) so New Accounts Found can show them.
  const groups = groupUnmatchedCandidates(unmatched);
  const suggestionRunId = useSuggestionSession.getState().start(groups);
  const suggestions = groups.map(group => ({ ...group.suggestion }));
  const scanned = messages.length;
  return {
    scanned,
    created,
    uncategorised,
    skipped: scanned - created,
    autoApproved,
    suggestions,
    suggestionRunId,
  };
}
