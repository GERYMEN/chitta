import { Account, AccountType } from '../../domain/accounts/account.types';
import { Category } from '../../domain/categories/category.types';
import { Transaction, TransactionType } from '../../domain/transactions/transaction.types';
import { ApprovalMode, shouldAutoApprove } from '../../domain/settings/approval.rules';
import {
  findTransferPairs,
  pairedTransactionIds,
  TransferDismissal,
} from '../../domain/transfers/transfer.rules';
import { ParsedSmsTransaction } from './smsParser';
import {
  DuplicateDismissal,
  duplicatePairIds,
  findDuplicatePairs,
} from '../../domain/duplicates/duplicate.rules';
import { activeAccounts, deletedAccounts } from '../../domain/accounts/account.rules';
import { accountKeyToString, ACCOUNT_KEY_NORMALIZER_VERSION } from './normalizeAccountKey';
import { normalizeMerchant } from '../../domain/merchants/normalizeMerchant';
import { categoryFitsType, UNCATEGORISED_ID } from '../../domain/categories/category.rules';
import type { CreateTransactionInput } from '../../data/repositories/transaction.repository';

/** Parser version stamped on every SMS-derived transaction. */
export const SMS_PARSER_VERSION = 'sms-heuristic-v1';

/**
 * Pure, dependency-free helpers for SMS sync so the account/category fallback
 * resolution and dedup logic can be unit-tested in isolation (no native module,
 * no store, no SQLite).
 */

/** Small serializable suggestion shape (no SMS content) for nav params. */
export interface SmsAccountSuggestion {
  bankName: string;
  accountKind: AccountType;
  lastFour: string | null;
  messageCount: number;
}

/** Signature a candidate's source is grouped by when no account matches. */
export type SmsAccountMatch = Pick<ParsedSmsTransaction, 'accountKind' | 'lastFour'>;

/**
 * Resolve the account for a parsed SMS. Exact match ONLY: an existing account
 * must share BOTH `type` and `lastFour` with the parsed candidate. Returns
 * `null` (not the first account) when no such match exists — callers treat
 * `null` as "needs a suggested account", never "assign to an arbitrary account".
 */
export function resolveAccountIdForSms(
  accounts: Account[],
  candidate: SmsAccountMatch,
): string | null {
  if (accounts.length === 0 || candidate.lastFour == null) return null;

  const matched = accounts.find(
    account =>
      account.type === candidate.accountKind && account.lastFour === candidate.lastFour,
  );
  return matched ? matched.id : null;
}

/**
 * Resolve the category for a parsed SMS (R2):
 *  1. a merchant rule for the normalized merchant key wins, if its category
 *     still exists, is not archived and fits the transaction type;
 *  2. otherwise the system "Uncategorised" bucket (type-neutral).
 * There is no "Shopping" / "Salary & Wages" default any more — an unmatched
 * item is visibly uncategorised, never silently filed. Returns null only if
 * neither exists (callers skip the item).
 */
export function resolveCategoryIdForSms(
  categories: ReadonlyArray<Category>,
  type: TransactionType,
  merchantName: string = '',
  rules: Readonly<Record<string, string>> = {},
): string | null {
  const key = normalizeMerchant(merchantName);
  const ruleCategoryId = key !== '' ? rules[key] : undefined;
  if (ruleCategoryId !== undefined) {
    const ruled = categories.find(category => category.id === ruleCategoryId);
    if (ruled && ruled.archivedAt === null && categoryFitsType(ruled.type, type)) {
      return ruled.id;
    }
  }

  const uncategorised = categories.find(category => category.id === UNCATEGORISED_ID);
  return uncategorised ? uncategorised.id : null;
}

/**
 * Filter out parsed candidates whose `sourceReferenceHash` is already present,
 * so re-running Sync SMS does not create duplicate transactions.
 */
export function filterNewCandidates(
  parsed: ParsedSmsTransaction[],
  existingHashes: ReadonlySet<string>,
): ParsedSmsTransaction[] {
  return parsed.filter(candidate => !existingHashes.has(candidate.sourceReferenceHash));
}

/**
 * Grouping signature of a suggested account:
 * `${accountKind}:${bankName}:${lastFour ?? 'unknown'}`. Used for the
 * "New Accounts Found" cards, their session cache and their React keys.
 */
export function suggestionKeyFor(
  candidate: Pick<SmsAccountSuggestion, 'accountKind' | 'bankName' | 'lastFour'>,
): string {
  return `${candidate.accountKind}:${candidate.bankName}:${candidate.lastFour ?? 'unknown'}`;
}

/**
 * Group candidates with no account match by `suggestionKeyFor` and produce
 * one suggestion per group, sorted by `messageCount` descending.
 */
export function groupUnmatchedIntoSuggestions(
  unmatched: ParsedSmsTransaction[],
): SmsAccountSuggestion[] {
  const byKey = new Map<string, SmsAccountSuggestion>();

  for (const candidate of unmatched) {
    const key = suggestionKeyFor(candidate);
    const existing = byKey.get(key);
    if (existing) {
      existing.messageCount += 1;
    } else {
      byKey.set(key, {
        bankName: candidate.bankName,
        accountKind: candidate.accountKind,
        lastFour: candidate.lastFour,
        messageCount: 1,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.messageCount - a.messageCount);
}

/** Candidate fields needed to decide whether a soft-deleted account owns it. */
export type SmsDeletedMatch = Pick<
  ParsedSmsTransaction,
  'accountKind' | 'lastFour' | 'bankCanonical'
>;

/**
 * D10: true when the candidate belongs to a soft-deleted account and must be
 * dropped (not imported, not suggested): either it exactly matches a deleted
 * account (same type + lastFour rule as active matching), or its normalized
 * key has a 'deleted' decision row. Callers check active matches FIRST, so an
 * active account always wins over a deleted one with the same key.
 */
export function isOwnedByDeletedAccount(
  deleted: Account[],
  deletedDecisionKeys: ReadonlySet<string>,
  candidate: SmsDeletedMatch,
): boolean {
  if (resolveAccountIdForSms(deleted, candidate) != null) return true;
  return deletedDecisionKeys.has(decisionKeyFor(candidate));
}

/**
 * R2b: explicit "New Accounts Found" decisions, by `accountKeyToString` key.
 * `routes` maps an 'added'/'linked' key to the account the user chose;
 * `ignored` keys are never imported or suggested again.
 */
export interface SuggestionDecisions {
  routes: ReadonlyMap<string, string>;
  ignored: ReadonlySet<string>;
}

export const NO_SUGGESTION_DECISIONS: SuggestionDecisions = {
  routes: new Map(),
  ignored: new Set(),
};

/** The normalized decision key (`accountKeyToString`) of a parsed SMS. */
export function decisionKeyFor(
  candidate: Pick<ParsedSmsTransaction, 'bankCanonical' | 'accountKind' | 'lastFour'>,
): string {
  return accountKeyToString({
    bankCanonical: candidate.bankCanonical,
    accountKind: candidate.accountKind,
    lastFour: candidate.lastFour ?? '',
    normalizerVersion: ACCOUNT_KEY_NORMALIZER_VERSION,
  });
}

export interface PartitionedCandidates {
  matched: Array<{ parsed: ParsedSmsTransaction; accountId: string }>;
  /** Owned by a soft-deleted account or an ignored key — counted into skipped. */
  dropped: ParsedSmsTransaction[];
  /** No account at all — grouped into "New Accounts Found" suggestions. */
  unmatched: ParsedSmsTransaction[];
}

/**
 * Split fresh candidates, in this order:
 *  1. exact match (type + lastFour) to an ACTIVE account — unchanged rule,
 *     always wins;
 *  2. an 'added'/'linked' decision for its key → that account if active,
 *     dropped if that account is soft-deleted;
 *  3. owned by a soft-deleted account (D10) or an 'ignored' key → dropped;
 *  4. otherwise unmatched (suggested).
 * `accounts` may contain both active and deleted accounts.
 */
export function partitionCandidates(
  candidates: ParsedSmsTransaction[],
  accounts: Account[],
  deletedDecisionKeys: ReadonlySet<string>,
  decisions: SuggestionDecisions = NO_SUGGESTION_DECISIONS,
): PartitionedCandidates {
  const active = activeAccounts(accounts);
  const deleted = deletedAccounts(accounts);
  const result: PartitionedCandidates = { matched: [], dropped: [], unmatched: [] };

  for (const parsed of candidates) {
    const accountId = resolveAccountIdForSms(active, parsed);
    if (accountId != null) {
      result.matched.push({ parsed, accountId });
      continue;
    }
    const key = decisionKeyFor(parsed);
    const routedId = decisions.routes.get(key);
    if (routedId !== undefined) {
      if (active.some(account => account.id === routedId)) {
        result.matched.push({ parsed, accountId: routedId });
        continue;
      }
      if (deleted.some(account => account.id === routedId)) {
        result.dropped.push(parsed);
        continue;
      }
    }
    if (
      decisions.ignored.has(key) ||
      isOwnedByDeletedAccount(deleted, deletedDecisionKeys, parsed)
    ) {
      result.dropped.push(parsed);
    } else {
      result.unmatched.push(parsed);
    }
  }
  return result;
}

/**
 * The pending transaction an SMS candidate becomes, minus its account (sync
 * and R2b "Add account" share this, so both paths insert identical rows).
 */
export function buildSmsPendingRow(
  parsed: ParsedSmsTransaction,
  categoryId: string,
  detectedAt: string,
): Omit<CreateTransactionInput, 'accountId'> {
  return {
    type: parsed.type,
    status: 'pending',
    amountMinor: parsed.amountMinor,
    currency: 'INR',
    merchantName: parsed.merchantName,
    categoryId,
    paymentMethod: 'other',
    occurredAt: parsed.occurredAt,
    detectedAt,
    approvedAt: null,
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: parsed.sourceReferenceHash,
    sanitizedPreview: parsed.sanitizedPreview,
    confidenceScore: parsed.confidenceScore,
    parserVersion: SMS_PARSER_VERSION,
  };
}

export function buildSmsTransactionInput(
  parsed: ParsedSmsTransaction,
  accountId: string,
  categoryId: string,
  detectedAt: string,
): CreateTransactionInput {
  return { ...buildSmsPendingRow(parsed, categoryId, detectedAt), accountId };
}

export interface PostSyncApproval {
  /** New items the opt-in auto rule approves. */
  approve: Transaction[];
  /** New items the auto rule WOULD approve but that form a possible transfer pair. */
  heldForTransfer: Transaction[];
  /** R3b: … or a possible duplicate pair (and no transfer pair). */
  heldForDuplicate: Transaction[];
}

/**
 * R3a T4: run AFTER all new pending items of a sync are inserted. Any new item
 * that forms a possible transfer pair (with another new item or an existing
 * pending/approved row) is NOT auto-approved — it stays pending so the user
 * decides "It's a transfer" / "Not a transfer" first. R3b: the same hold for a
 * new item that forms a possible duplicate pair. Every other new item follows
 * the unchanged single auto-approve rule (`shouldAutoApprove`).
 */
export function autoApproveAfterSync(
  created: ReadonlyArray<Transaction>,
  allTransactions: ReadonlyArray<Transaction>,
  accounts: ReadonlyArray<Pick<Account, 'id' | 'deletedAt'>>,
  dismissals: ReadonlyArray<Pick<TransferDismissal, 'debitId' | 'creditId'>>,
  mode: ApprovalMode,
  threshold: number,
  duplicateDismissals: ReadonlyArray<Pick<DuplicateDismissal, 'aId' | 'bId'>> = [],
): PostSyncApproval {
  const eligible = created.filter(
    t => t.status === 'pending' && shouldAutoApprove(mode, threshold, t.confidenceScore),
  );
  if (eligible.length === 0) return { approve: [], heldForTransfer: [], heldForDuplicate: [] };
  const paired = pairedTransactionIds(findTransferPairs(allTransactions, accounts, dismissals));
  const duplicates = duplicatePairIds(findDuplicatePairs(allTransactions, duplicateDismissals));
  return {
    approve: eligible.filter(t => !paired.has(t.id) && !duplicates.has(t.id)),
    heldForTransfer: eligible.filter(t => paired.has(t.id)),
    heldForDuplicate: eligible.filter(t => !paired.has(t.id) && duplicates.has(t.id)),
  };
}
