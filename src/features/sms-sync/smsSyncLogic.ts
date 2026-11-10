import { Account, AccountType } from '../../domain/accounts/account.types';
import { Category } from '../../domain/categories/category.types';
import { Transaction, TransactionType } from '../../domain/transactions/transaction.types';
import { ApprovalMode, shouldAutoApprove } from '../../domain/settings/approval.rules';
import {
  findTransferPairs,
  pairedTransactionIds,
  TransferDismissal,
} from '../../domain/transfers/transfer.rules';
import { ParsedSmsTransaction, PARSER_VERSION } from './smsParser';
import {
  DuplicateDismissal,
  duplicatePairIds,
  findDuplicatePairs,
} from '../../domain/duplicates/duplicate.rules';
import { activeAccounts, deletedAccounts } from '../../domain/accounts/account.rules';
import {
  accountKeyToString,
  ACCOUNT_KEY_NORMALIZER_VERSION,
  bankCanonicalForText,
} from './normalizeAccountKey';
import { refTombstoneKey } from './smsIdentity';
import type { SmsTombstoneRow } from '../../data/repositories/smsDeletedRefs.repository';
import { legacyKeyString } from './legacy/normalizeAccountKeyV1';
import { normalizeMerchant } from '../../domain/merchants/normalizeMerchant';
import { categoryFitsType, UNCATEGORISED_ID } from '../../domain/categories/category.rules';
import type { CreateTransactionInput } from '../../data/repositories/transaction.repository';

/** Parser version stamped on every SMS-derived transaction (R5: reader v2). */
export const SMS_PARSER_VERSION = `sms-reader-v${PARSER_VERSION}`;

/**
 * R5: stamped on an item the USER added from "Messages not understood". The
 * row keeps the SMS reference (dedupe + "View original SMS"); its audit is
 * 'created' by the user, not 'detected'.
 */
export const SMS_USER_ADDED_PARSER_VERSION = 'sms-user-added';

/**
 * R5g T3: parser_version of a row a template took part in (no new column):
 * `sms-reader-v2+rules-v<n>:<pattern_UID>` for a template record, and
 * `sms-reader-v2+rules-v<n>:disagree:<pattern_UID>` for an N1 disagreement
 * (the row carries the reader's values and is held for review).
 */
export function parserVersionFor(
  parsed: Pick<ParsedSmsTransaction, 'patternUid' | 'rulesVersion' | 'ruleDisagreement'>,
): string {
  if (!parsed.patternUid) return SMS_PARSER_VERSION;
  const base = `${SMS_PARSER_VERSION}+rules-v${parsed.rulesVersion ?? 0}`;
  return parsed.ruleDisagreement ? `${base}:disagree:${parsed.patternUid}` : `${base}:${parsed.patternUid}`;
}

const DISAGREE_TAG = /\+rules-v\d+:disagree:/;

/** R5g N1: Pending shows "Check this one: two readers disagree" for these rows. */
export function isRuleDisagreementRow(t: Pick<Transaction, 'parserVersion'>): boolean {
  return DISAGREE_TAG.test(t.parserVersion ?? '');
}

/**
 * R5g: why a new item is held from auto-approve besides R3a/R3b pairs and
 * R5d's card payment — an N1 disagreement, or a template money_kind that
 * R5e will convert (transfer / ATM / wallet top-up / EMI / refund).
 */
export type RuleHoldReason =
  | 'rule_disagreement'
  | 'transfer'
  | 'atm'
  | 'wallet_load'
  | 'emi'
  | 'refund'
  /** Item 21: a chaining outcome (duplicate / refund link / twin / incomplete). */
  | 'chain';

const MONEY_KIND_HOLDS: ReadonlySet<string> = new Set(['transfer', 'atm', 'wallet_load', 'emi', 'refund']);

export function ruleHoldReasonFor(
  parsed: Pick<ParsedSmsTransaction, 'ruleDisagreement' | 'moneyHint'>,
): RuleHoldReason | null {
  if (parsed.ruleDisagreement) return 'rule_disagreement';
  if (parsed.moneyHint && MONEY_KIND_HOLDS.has(parsed.moneyHint)) return parsed.moneyHint as RuleHoldReason;
  return null;
}

/** R5: the seeded "Salary & Wages" category (connection.ts seed). */
export const SALARY_CATEGORY_ID = 'cat-salary';

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
  /** R5g item 18: a template's account_name_override (proposed display name). */
  accountName?: string;
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
 * R5d T3a: a 3-digit mask ("Acct XX888", lastDigits '888', no last-4) matches
 * an ACTIVE account only when the bank is the same (the account's name
 * resolves to the candidate's bank), the account's last-4 ends with those
 * digits, and exactly ONE account qualifies. Otherwise null — never a guess.
 */
export function resolveAccountBySuffix(
  accounts: ReadonlyArray<Account>,
  candidate: Pick<ParsedSmsTransaction, 'lastFour' | 'lastDigits' | 'bankCanonical'>,
): string | null {
  const digits = candidate.lastDigits;
  if (candidate.lastFour != null || !digits || candidate.bankCanonical === 'unknown') return null;
  const hits = accounts.filter(account => {
    const own = account.lastFour ?? '';
    return (
      own.length === 4 &&
      own.endsWith(digits) &&
      bankCanonicalForText(account.name) === candidate.bankCanonical
    );
  });
  return hits.length === 1 ? hits[0].id : null;
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
  salary: boolean = false,
): string | null {
  const key = normalizeMerchant(merchantName);
  const ruleCategoryId = key !== '' ? rules[key] : undefined;
  if (ruleCategoryId !== undefined) {
    const ruled = categories.find(category => category.id === ruleCategoryId);
    if (ruled && ruled.archivedAt === null && categoryFitsType(ruled.type, type)) {
      return ruled.id;
    }
  }

  // R5: a salary credit goes to the seeded Salary category (if it still
  // exists, is not archived and fits income). A merchant rule still wins.
  if (salary && type === 'income') {
    const salaryCategory = categories.find(category => category.id === SALARY_CATEGORY_ID);
    if (salaryCategory && salaryCategory.archivedAt === null && categoryFitsType(salaryCategory.type, type)) {
      return salaryCategory.id;
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

// ---- R5d dedupe -----------------------------------------------------------------

/**
 * R5d: everything a sync dedupes a candidate against, built once per run
 * from the store rows + the tombstones and extended with each new item.
 *  - sourceHashes: the unchanged `sms-<id>-<date>` keys (old rows keep deduping);
 *  - contentHashes: salted content hashes (T1) — survive a changed inbox id;
 *  - refKeys: `<refDigest>:<type>:<amount>` of live or rejected rows (T2);
 *  - tombstoneRefKeys: the same, hashed (refTombstoneKey), of deleted rows;
 *  - rowsMissingContent / tombstonesMissingContent: old keys whose row or
 *    tombstone has no content hash yet (lazy backfill).
 */
export interface SmsDedupeIndex {
  sourceHashes: Set<string>;
  contentHashes: Set<string>;
  refKeys: Set<string>;
  tombstoneRefKeys: Set<string>;
  rowsMissingContent: Map<string, string>;
  tombstonesMissingContent: Set<string>;
}

/** Rows whose reference blocks a new item with the same ref + type + amount. */
const REF_DEDUPE_STATUSES: ReadonlySet<Transaction['status']> = new Set([
  'pending',
  'approved',
  'rejected',
]);

export function refKeyOf(refDigest: string, type: TransactionType, amountMinor: number): string {
  return `${refDigest}:${type}:${amountMinor}`;
}

export function buildSmsDedupeIndex(
  transactions: ReadonlyArray<
    Pick<Transaction, 'id' | 'status' | 'type' | 'amountMinor' | 'sourceReferenceHash' | 'smsContentHash' | 'refDigest'>
  >,
  tombstones: ReadonlyArray<SmsTombstoneRow> = [],
): SmsDedupeIndex {
  const index: SmsDedupeIndex = {
    sourceHashes: new Set(),
    contentHashes: new Set(),
    refKeys: new Set(),
    tombstoneRefKeys: new Set(),
    rowsMissingContent: new Map(),
    tombstonesMissingContent: new Set(),
  };
  for (const t of transactions) {
    if (t.sourceReferenceHash) {
      index.sourceHashes.add(t.sourceReferenceHash);
      if (!t.smsContentHash) index.rowsMissingContent.set(t.sourceReferenceHash, t.id);
    }
    if (t.smsContentHash) index.contentHashes.add(t.smsContentHash);
    if (t.refDigest && REF_DEDUPE_STATUSES.has(t.status)) {
      index.refKeys.add(refKeyOf(t.refDigest, t.type, t.amountMinor));
    }
  }
  for (const tomb of tombstones) {
    index.sourceHashes.add(tomb.sourceReferenceHash);
    if (tomb.smsContentHash) index.contentHashes.add(tomb.smsContentHash);
    else index.tombstonesMissingContent.add(tomb.sourceReferenceHash);
    if (tomb.refKey) index.tombstoneRefKeys.add(tomb.refKey);
  }
  return index;
}

/** Content hashes to write on old rows / tombstones (collected during a run). */
export interface SmsBackfill {
  rows: Array<{ id: string; smsContentHash: string }>;
  tombstones: Array<{ sourceReferenceHash: string; smsContentHash: string }>;
}

export type SmsDedupeVerdict =
  /** Not seen: insert it. */
  | 'new'
  /** Same SMS (old key or content hash) already recorded or deleted. */
  | 'known'
  /** Another SMS with the same reference + type + amount is recorded (T2). */
  | 'same_reference';

/**
 * R5d dedupe order: (1) lazy backfill of an old row / tombstone matched by its
 * old key, (2) old key, (3) content hash, (4) reference + type + amount
 * (live / rejected rows, this run, tombstones). Pure apart from appending to
 * `backfill` and clearing the backfill markers it used.
 */
export function checkSmsCandidate(
  index: SmsDedupeIndex,
  candidate: Pick<
    ParsedSmsTransaction,
    'sourceReferenceHash' | 'smsContentHash' | 'refDigest' | 'type' | 'amountMinor'
  >,
  backfill?: SmsBackfill,
): SmsDedupeVerdict {
  const oldKey = candidate.sourceReferenceHash;
  const content = candidate.smsContentHash;
  if (content && backfill) {
    const rowId = index.rowsMissingContent.get(oldKey);
    if (rowId !== undefined) {
      backfill.rows.push({ id: rowId, smsContentHash: content });
      index.rowsMissingContent.delete(oldKey);
      index.contentHashes.add(content);
    }
    if (index.tombstonesMissingContent.has(oldKey)) {
      backfill.tombstones.push({ sourceReferenceHash: oldKey, smsContentHash: content });
      index.tombstonesMissingContent.delete(oldKey);
      index.contentHashes.add(content);
    }
  }
  if (index.sourceHashes.has(oldKey)) return 'known';
  if (content && index.contentHashes.has(content)) return 'known';
  if (candidate.refDigest) {
    if (index.refKeys.has(refKeyOf(candidate.refDigest, candidate.type, candidate.amountMinor))) {
      return 'same_reference';
    }
    if (
      index.tombstoneRefKeys.size > 0 &&
      index.tombstoneRefKeys.has(refTombstoneKey(candidate.refDigest, candidate.type, candidate.amountMinor))
    ) {
      return 'same_reference';
    }
  }
  return 'new';
}

/** Record a candidate taken by this run, so later pages / items dedupe against it. */
export function rememberSmsCandidate(
  index: SmsDedupeIndex,
  candidate: Pick<
    ParsedSmsTransaction,
    'sourceReferenceHash' | 'smsContentHash' | 'refDigest' | 'type' | 'amountMinor'
  >,
): void {
  index.sourceHashes.add(candidate.sourceReferenceHash);
  if (candidate.smsContentHash) index.contentHashes.add(candidate.smsContentHash);
  if (candidate.refDigest) {
    index.refKeys.add(refKeyOf(candidate.refDigest, candidate.type, candidate.amountMinor));
  }
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

/**
 * R5-fix C1: the decision key parser v1 produced for this candidate — computed
 * from the same body by the frozen v1 normalizer (`legacyKey`), never guessed.
 * Null when it equals the primary key or is unknown (row built outside the reader).
 */
export function legacyDecisionKeyFor(
  candidate: Pick<ParsedSmsTransaction, 'bankCanonical' | 'accountKind' | 'lastFour' | 'legacyKey'>,
): string | null {
  if (!candidate.legacyKey) return null;
  const legacy = legacyKeyString(candidate.legacyKey);
  return legacy === decisionKeyFor(candidate) ? null : legacy;
}

/** v1's account match for this SMS: v1 kind + v1 last-4 (exact, like v1). */
function legacyAccountMatch(active: Account[], parsed: ParsedSmsTransaction): string | null {
  const legacy = parsed.legacyKey;
  if (!legacy || legacy.lastFour === '') return null;
  if (legacy.accountKind === parsed.accountKind && legacy.lastFour === parsed.lastFour) return null;
  return resolveAccountIdForSms(active, { accountKind: legacy.accountKind, lastFour: legacy.lastFour });
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
 *  4. R5d: a unique 3-digit suffix match on the same bank (resolveAccountBySuffix);
 *  5. otherwise unmatched (suggested).
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
    // R5-fix C1: an account v1 matched for this SMS (v1 kind + v1 last-4) keeps matching.
    const accountId = resolveAccountIdForSms(active, parsed) ?? legacyAccountMatch(active, parsed);
    if (accountId != null) {
      result.matched.push({ parsed, accountId });
      continue;
    }
    const key = decisionKeyFor(parsed);
    // R5-fix C1: decisions saved under v1 apply under v1's EXACT key for this
    // body (frozen v1 normalizer) — never a guessed 'unknown' variant.
    const legacyKey = legacyDecisionKeyFor(parsed);
    const routedId =
      decisions.routes.get(key) ?? (legacyKey != null ? decisions.routes.get(legacyKey) : undefined);
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
      (legacyKey != null && (decisions.ignored.has(legacyKey) || deletedDecisionKeys.has(legacyKey))) ||
      isOwnedByDeletedAccount(deleted, deletedDecisionKeys, parsed)
    ) {
      result.dropped.push(parsed);
      continue;
    }
    // R5d T3a: a unique 3-digit suffix match on the same bank (never a guess).
    const suffixId = resolveAccountBySuffix(active, parsed);
    if (suffixId != null) {
      result.matched.push({ parsed, accountId: suffixId });
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
    parserVersion: parserVersionFor(parsed),
    // R5d: one-way identities (no SMS content) for cross-run / cross-phone dedupe.
    smsContentHash: parsed.smsContentHash ?? null,
    refDigest: parsed.refDigest ?? null,
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
  /**
   * R5d T0e: … or a credit-card bill paid from a bank a/c (moneyHint
   * 'card_payment'; R5e turns these into transfers) — and no pair above.
   */
  heldForCardPayment: Transaction[];
  /** R5g: … or an N1 disagreement / a held template money_kind — and no pair above. */
  heldForRule: Array<{ transaction: Transaction; reason: RuleHoldReason }>;
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
  /** R5d: ids of new items with moneyHint 'card_payment' (held, never auto-approved). */
  cardPaymentIds: ReadonlySet<string> = new Set(),
  /** R5g: new items held for an N1 disagreement or a template money_kind. */
  ruleHolds: ReadonlyMap<string, RuleHoldReason> = new Map(),
): PostSyncApproval {
  const eligible = created.filter(
    t => t.status === 'pending' && shouldAutoApprove(mode, threshold, t.confidenceScore),
  );
  if (eligible.length === 0) {
    return { approve: [], heldForTransfer: [], heldForDuplicate: [], heldForCardPayment: [], heldForRule: [] };
  }
  const paired = pairedTransactionIds(findTransferPairs(allTransactions, accounts, dismissals));
  const duplicates = duplicatePairIds(findDuplicatePairs(allTransactions, duplicateDismissals));
  const unpaired = (t: Transaction) => !paired.has(t.id) && !duplicates.has(t.id);
  const disagreement = (t: Transaction) => ruleHolds.get(t.id) === 'rule_disagreement';
  return {
    approve: eligible.filter(t => unpaired(t) && !cardPaymentIds.has(t.id) && !ruleHolds.has(t.id)),
    heldForTransfer: eligible.filter(t => paired.has(t.id)),
    heldForDuplicate: eligible.filter(t => !paired.has(t.id) && duplicates.has(t.id)),
    heldForCardPayment: eligible.filter(t => unpaired(t) && cardPaymentIds.has(t.id) && !disagreement(t)),
    heldForRule: eligible
      .filter(t => unpaired(t) && ruleHolds.has(t.id) && (disagreement(t) || !cardPaymentIds.has(t.id)))
      .map(t => ({ transaction: t, reason: ruleHolds.get(t.id) as RuleHoldReason })),
  };
}
