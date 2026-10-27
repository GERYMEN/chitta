import { Account, AccountType } from '../../domain/accounts/account.types';
import { Category } from '../../domain/categories/category.types';
import { TransactionType } from '../../domain/transactions/transaction.types';
import { ParsedSmsTransaction } from './smsParser';
import { activeAccounts, deletedAccounts } from '../../domain/accounts/account.rules';
import { accountKeyToString, ACCOUNT_KEY_NORMALIZER_VERSION } from './normalizeAccountKey';

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
 * Resolve a generic category for a parsed SMS. v1 has no reliable category
 * signal, so: expense -> the "Shopping" system category, income -> the
 * "Salary & Wages" system category. Falls back to the first category of the
 * matching type if the named category is missing.
 */
export function resolveCategoryIdForSms(
  categories: Category[],
  type: TransactionType,
): string | null {
  const targetName = type === 'expense' ? 'Shopping' : 'Salary & Wages';

  const byName = categories.find(category => category.name === targetName);
  if (byName) return byName.id;

  const byType = categories.find(category => category.type === type);
  return byType ? byType.id : null;
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
 * Group candidates with no account match by the signature
 * `${accountKind}:${bankName}:${lastFour ?? 'unknown'}` and produce one
 * suggestion per group, sorted by `messageCount` descending.
 */
export function groupUnmatchedIntoSuggestions(
  unmatched: ParsedSmsTransaction[],
): SmsAccountSuggestion[] {
  const byKey = new Map<string, SmsAccountSuggestion>();

  for (const candidate of unmatched) {
    const key = `${candidate.accountKind}:${candidate.bankName}:${candidate.lastFour ?? 'unknown'}`;
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
  const key = accountKeyToString({
    bankCanonical: candidate.bankCanonical,
    accountKind: candidate.accountKind,
    lastFour: candidate.lastFour ?? '',
    normalizerVersion: ACCOUNT_KEY_NORMALIZER_VERSION,
  });
  return deletedDecisionKeys.has(key);
}

export interface PartitionedCandidates {
  matched: Array<{ parsed: ParsedSmsTransaction; accountId: string }>;
  /** Owned by a soft-deleted account — counted into skipped. */
  dropped: ParsedSmsTransaction[];
  /** No account at all — grouped into "New Accounts Found" suggestions. */
  unmatched: ParsedSmsTransaction[];
}

/**
 * Split fresh candidates into: matched to an ACTIVE account, dropped because a
 * soft-deleted account owns them, or unmatched. `accounts` may contain both
 * active and deleted accounts; the split is done here.
 */
export function partitionCandidates(
  candidates: ParsedSmsTransaction[],
  accounts: Account[],
  deletedDecisionKeys: ReadonlySet<string>,
): PartitionedCandidates {
  const active = activeAccounts(accounts);
  const deleted = deletedAccounts(accounts);
  const result: PartitionedCandidates = { matched: [], dropped: [], unmatched: [] };

  for (const parsed of candidates) {
    const accountId = resolveAccountIdForSms(active, parsed);
    if (accountId != null) {
      result.matched.push({ parsed, accountId });
    } else if (isOwnedByDeletedAccount(deleted, deletedDecisionKeys, parsed)) {
      result.dropped.push(parsed);
    } else {
      result.unmatched.push(parsed);
    }
  }
  return result;
}
