import { CreateTransactionInput } from '../../data/repositories/transaction.repository';
import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { readInbox } from '../../native/android/sms/smsReader';
import {
  checkSmsPermission,
  requestSmsPermission,
} from '../../native/android/permissions/smsPermission';
import { parseSmsMessage } from './smsParser';
import { shouldAutoApprove } from '../../domain/settings/approval.rules';
import {
  filterNewCandidates,
  groupUnmatchedIntoSuggestions,
  partitionCandidates,
  resolveCategoryIdForSms,
  SmsAccountSuggestion,
} from './smsSyncLogic';
import { accountRepository } from '../../data/repositories/account.repository';
import { activeAccounts } from '../../domain/accounts/account.rules';

export interface SmsSyncResult {
  scanned: number;
  created: number;
  skipped: number;
  /** New SMS transactions from THIS sync approved by the opt-in auto mode. */
  autoApproved: number;
  suggestions: SmsAccountSuggestion[];
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

const PARSER_VERSION = 'sms-heuristic-v1';
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
 * this path. There is no audit-event writer in the codebase yet, so no audit
 * row is recorded for auto-approvals.
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
  const deletedDecisionKeys = await accountRepository.listDeletedDecisionKeys();
  const { matched, unmatched } = partitionCandidates(
    fresh,
    store.accounts,
    deletedDecisionKeys,
  );

  // Snapshot the policy once so a settings change mid-sync can't mix modes.
  const { approvalMode, autoApproveThreshold } = store;

  let created = 0;
  let autoApproved = 0;
  for (const { parsed, accountId } of matched) {
    const categoryId = resolveCategoryIdForSms(store.categories, parsed.type);
    if (categoryId == null) continue;

    const input: CreateTransactionInput = {
      type: parsed.type,
      status: 'pending',
      amountMinor: parsed.amountMinor,
      currency: 'INR',
      merchantName: parsed.merchantName,
      categoryId,
      accountId,
      paymentMethod: 'other',
      occurredAt: parsed.occurredAt,
      detectedAt: new Date().toISOString(),
      approvedAt: null,
      note: null,
      sourceType: 'sms',
      sourceReferenceHash: parsed.sourceReferenceHash,
      sanitizedPreview: parsed.sanitizedPreview,
      confidenceScore: parsed.confidenceScore,
      parserVersion: PARSER_VERSION,
    };

    const createdTransaction = await useTransactionsStore.getState().addTransaction(input);
    created++;

    if (
      shouldAutoApprove(approvalMode, autoApproveThreshold, createdTransaction.confidenceScore)
    ) {
      await useTransactionsStore.getState().approve(createdTransaction.id);
      const after = useTransactionsStore
        .getState()
        .transactions.find(t => t.id === createdTransaction.id);
      if (after?.status === 'approved') autoApproved++;
    }
  }

  const suggestions = groupUnmatchedIntoSuggestions(unmatched);
  const scanned = messages.length;
  return { scanned, created, skipped: scanned - created, autoApproved, suggestions };
}
