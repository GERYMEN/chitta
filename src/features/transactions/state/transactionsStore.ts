import { create } from 'zustand';
import { tagRepository } from '../../../data/repositories/tag.repository';
import { Tag } from '../../../domain/tags/tag.types';
import { deleteReceiptFile } from '../../../native/android/receipts/receiptNative';
import { Transaction, TransactionStatus } from '../../../domain/transactions/transaction.types';
import { Account } from '../../../domain/accounts/account.types';
import { Category, MerchantRule } from '../../../domain/categories/category.types';
import {
  CategoryChange,
  invertChanges,
  ruleApplyTargets,
} from '../../../domain/categories/category.rules';
import { normalizeMerchant } from '../../../domain/merchants/normalizeMerchant';
import { canTransition } from '../../../domain/transactions/transaction.rules';
import {
  confirmTransferPair as buildPairConfirmation,
  findTransferTwin,
  MANUAL_TRANSFER_TITLE,
  markAsTransferPatch,
  TransferDismissal,
  undoTransferPair,
} from '../../../domain/transfers/transfer.rules';
import { TRANSFER_CATEGORY_ID } from '../../../domain/categories/category.rules';
import { transferRepository } from '../../../data/repositories/transfer.repository';
import { linkRepository } from '../../../data/repositories/link.repository';
import {
  linkRefundPatch,
  RefundLinkError,
  refundsFor,
  unlinkRefundPatch,
  validateRefundLink,
} from '../../../domain/refunds/refund.rules';
import {
  DuplicateDismissal,
  findDuplicatePairs,
  markDuplicate as buildDuplicateMarking,
  restoreDuplicate as buildDuplicateRestore,
} from '../../../domain/duplicates/duplicate.rules';
import { isLinkedRefund } from '../../../domain/transactions/transaction.rules';
import { linkedEditError } from '../../../domain/links/linkedEdit.rules';
import { activeAccounts, deletedAccounts } from '../../../domain/accounts/account.rules';
import { runMigrations } from '../../../data/db/connection';
import {
  transactionRepository,
  CreateTransactionInput,
  SmsTombstoneInput,
  TransactionPatch,
} from '../../../data/repositories/transaction.repository';
import { refTombstoneKey } from '../../sms-sync/smsIdentity';
import {
  accountRepository,
  AccountPatch,
  CreateAccountInput,
} from '../../../data/repositories/account.repository';
import {
  categoryRepository,
  CategoryPatch,
  CreateCategoryInput,
} from '../../../data/repositories/category.repository';
import { merchantRuleRepository } from '../../../data/repositories/merchantRule.repository';
import {
  ImportSuggestionInput,
  ImportSuggestionResult,
  suggestionRepository,
  UndoLinkInput,
} from '../../../data/repositories/suggestion.repository';
import type { AccountKey } from '../../sms-sync/normalizeAccountKey';
import { isRuleDisagreementRow, SMS_USER_ADDED_PARSER_VERSION } from '../../sms-sync/smsSyncLogic';
import { chainDuplicatePairs, useChainSuggestions } from '../../sms-sync/rules/chaining';
import {
  noteLoadedFilters,
  parsePersistedFilters,
  persistFilters,
  readPersistedFilters,
} from '../filters/filterPersistence';
import { settingsRepository } from '../../../data/repositories/settings.repository';
import {
  ApprovalMode,
  clampThreshold,
  DEFAULT_APPROVAL_MODE,
  DEFAULT_AUTO_APPROVE_THRESHOLD,
  parseApprovalMode,
  parseThreshold,
  SETTINGS_KEYS,
} from '../../../domain/settings/approval.rules';
import {
  AuditActor,
  AuditEventDraft,
  AuditEventInput,
} from '../../../domain/audit/audit.types';
import {
  changedAccountFields,
  changedTransactionFields,
  editedMetadata,
} from '../../../domain/audit/audit.rules';
import {
  DEFAULT_TRANSACTION_FILTERS,
  TransactionFilters,
} from '../filters/transactionFilters';
import { Period } from '../../../domain/periods/period.types';
import {
  parseIsoOrNull,
  parseStartMode,
  SMS_SYNC_KEYS,
  SmsSyncStartMode,
  smsTransactionBounds,
  upgradeDefaultStart,
} from '../../../domain/settings/smsSyncStart.rules';
import { smsSyncRepository } from '../../../data/repositories/smsSync.repository';
import { DEFAULT_PERIOD } from '../../../domain/periods/period.rules';
import { meaningRepository, MeaningRuleWrite } from '../../../data/repositories/meaning.repository';
import type { MeaningRule, MeaningSuggestion } from '../../../domain/meaning/meaning.types';
import {
  buildMeaningConversion,
  buildMeaningTwinAttach,
  candidateFromSuggestion,
  isInTransferPair,
  lateMeaningTransfer,
  meaningCounterpart,
  meaningPartner,
  meaningSideOf,
  planMeaningRule,
  undoMeaningConversion,
} from '../../../domain/meaning/meaning.rules';
import { generateId } from '../../../shared/utils/id';
import { billRepository } from '../../../data/repositories/bill.repository';
import { useBillsStore } from '../../bills/state/billsStore';

/** R3a: Add Record → Transfer / Edit transfer form values (paise, ISO date). */
export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  occurredAt: string;
  note: string | null;
  /**
   * R5-fix U9: added from "Messages not understood" — the transfer keeps the
   * SMS reference (dedupe on later syncs + "View original SMS").
   */
  smsReference?: { hash: string; parserVersion: string; contentHash?: string | null } | null;
}

export interface ProfilePatch {
  userName?: string;
  approvalMode?: ApprovalMode;
  autoApproveThreshold?: number;
}

/**
 * Set by `syncSms` when its opt-in auto mode approves a fresh SMS item: the
 * audit row is then `auto_approved` by 'system' with the score + threshold.
 * R2b: the Pending "Auto-approve (N)" button passes actor 'user' (the user
 * tapped it; the rule picked the items).
 */
export interface AutoApproval {
  confidence: number;
  threshold: number;
  /** Default 'system'. */
  actor?: AuditActor;
}

/**
 * R4b: what "Approve all" changed, so Undo returns exactly these items. The
 * `approvedAt` written by the approval is kept: Undo only touches an item
 * that is still approved with that same timestamp and link (nobody changed
 * it since).
 */
export interface ApprovalSnapshot {
  id: string;
  approvedAt: string | null;
  linkKind: Transaction['linkKind'] | null;
}

/** Audit `from` value of an R4b settings key that did not exist yet. */
export const SETTING_UNSET = 'unset';

/**
 * Hydration/cache layer over the on-device SQLite repositories. Screens read
 * and write through this store only — no screen imports SQLite directly.
 */
interface TransactionsState {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  /** R2: normalized merchant key → category id ("Always use …"). */
  merchantRules: Record<string, string>;
  isHydrated: boolean;
  hasOnboarded: boolean;
  userName: string;
  approvalMode: ApprovalMode;
  autoApproveThreshold: number;
  /** R4b: where SMS sync starts (null mode = not chosen yet). */
  smsSyncStartMode: SmsSyncStartMode | null;
  /** ISO; null = whole inbox. */
  smsSyncStartAt: string | null;
  /** ISO of the newest SMS date a normal sync fully processed. */
  smsLastSyncedAt: string | null;
  /**
   * R4b: save the sync start (mode + date). Each changed key is audited
   * 'settings_changed' {key, from, to} — dates/mode names only.
   */
  setSmsSyncStart: (
    mode: SmsSyncStartMode,
    startAt: string | null,
    actor?: AuditActor,
  ) => Promise<void>;
  /** R4b: sync cursor (not a user setting — not audited). */
  setSmsLastSyncedAt: (iso: string) => Promise<void>;
  /**
   * R4b upgrade path: onboarding already done and no start saved → 'custom'
   * at the earliest of (first sms_sync_runs start, earliest SMS-sourced
   * transaction), else `now`. No UI. Returns true when it wrote something.
   */
  applySmsSyncStartUpgrade: (now?: Date) => Promise<boolean>;
  /** R4b: Pending "Approve all" — each item via `approve` (canTransition, audited). */
  approveAll: (ids: ReadonlyArray<string>) => Promise<ApprovalSnapshot[]>;
  /** R4b: Undo of "Approve all" — back to pending, audited 'approval_undone'. */
  undoApprovals: (snapshots: ReadonlyArray<ApprovalSnapshot>) => Promise<number>;
  hydrate: () => Promise<void>;
  /**
   * R4e: re-read everything from SQLite (after a backup restore): rows,
   * settings, sync start/cursor; session filters + period back to defaults.
   */
  reloadFromDatabase: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  updateProfile: (patch: ProfilePatch) => Promise<void>;
  /** Transactions-list filters (R1); kept here so they survive tab switches. */
  transactionFilters: TransactionFilters;
  setTransactionFilters: (patch: Partial<TransactionFilters>) => void;
  /** R1 Reset — R4: also puts the selected period back to 1M. */
  resetTransactionFilters: () => void;
  /**
   * R4: the period (1M…1Y) shared by Home, Transactions and Insights so they
   * always agree. Session-only: starts at 1M, never persisted, not a
   * setting, never audited (it changes no money).
   */
  selectedPeriod: Period;
  setSelectedPeriod: (period: Period) => void;
  approve: (id: string, auto?: AutoApproval) => Promise<void>;
  reject: (id: string) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  /** R11: custom tags (user content) + transactionId -> tag ids. Auto tags are derived, not here. */
  tags: Tag[];
  tagLinks: Record<string, string[]>;
  /** R11: attach a custom tag by name (normalized, deduped). Returns the tag, or null for an invalid name. */
  addTagToTransaction: (transactionId: string, name: string) => Promise<Tag | null>;
  removeTagFromTransaction: (transactionId: string, tagId: string) => Promise<boolean>;
  /** R11: set (file name) / clear (null) the receipt; audited. Does not touch the file. */
  setReceiptPath: (transactionId: string, receiptPath: string | null) => Promise<boolean>;
  refresh: () => Promise<void>;
  addTransaction: (input: CreateTransactionInput) => Promise<Transaction>;
  /** R3b.1: false (no write) when the edit breaks a link (see linkedEditError). */
  updateTransaction: (id: string, patch: TransactionPatch) => Promise<boolean>;
  addAccount: (input: CreateAccountInput) => Promise<void>;
  updateAccount: (id: string, patch: AccountPatch) => Promise<void>;
  /** D10 soft delete — the account's transactions are never touched. */
  removeAccount: (id: string) => Promise<void>;
  /**
   * R6 (D-e1) "Use bank balance": set the EXISTING user anchor to the latest
   * SMS-reported balance, as of that SMS's time. Audited by updateAccount ('account_updated',
   * fields balanceAnchorMinor + balanceAnchorAt — names only). false when the
   * account has no snapshot.
   */
  applyBankBalance: (id: string) => Promise<boolean>;
  /** R6 (D-e3) "Dismiss": hide the difference for the CURRENT snapshot only. */
  dismissBalanceDifference: (id: string) => Promise<void>;
  restoreAccount: (id: string) => Promise<void>;
  /** R2b: Add/Link a suggested account + insert its waiting SMS as pending. */
  importSuggestion: (input: ImportSuggestionInput) => Promise<ImportSuggestionResult>;
  /** R2b: Ignore a suggested account key (never suggested/imported again). */
  ignoreSuggestion: (key: AccountKey) => Promise<void>;
  /** R5j: drop an 'ignored' decision so the key's SMS are handled again. */
  unignoreSuggestion: (key: AccountKey) => Promise<void>;
  /** R5: Undo of "Link to existing" (see suggestionRepository.undoLink). */
  undoLinkSuggestion: (input: UndoLinkInput) => Promise<number>;
  /**
   * R5d lazy backfill: write the content hash on rows that lack it (no
   * audit, no other field — see transactionRepository.setContentHashes).
   */
  backfillSmsContentHashes: (rows: ReadonlyArray<{ id: string; smsContentHash: string }>) => Promise<void>;
  /** R2: "Always use <category> for <merchant>" — audited 'rule_saved'. */
  saveMerchantRule: (
    merchantName: string,
    categoryId: string,
    transactionId?: string | null,
  ) => Promise<void>;
  deleteMerchantRule: (merchantKey: string) => Promise<void>;
  /** Other pending/approved items of the same merchant a rule would change. */
  ruleTargets: (merchantName: string, categoryId: string, excludeId: string | null) => CategoryChange[];
  /** Apply a set of category changes in one db.transaction; returns them for Undo. */
  applyCategoryChanges: (changes: ReadonlyArray<CategoryChange>) => Promise<CategoryChange[]>;
  /** Undo: restores each item's exact previous category id. */
  undoCategoryChanges: (applied: ReadonlyArray<CategoryChange>) => Promise<void>;
  addCategory: (input: CreateCategoryInput) => Promise<Category>;
  updateCategory: (id: string, patch: CategoryPatch) => Promise<void>;
  archiveCategory: (id: string) => Promise<void>;
  /** R5j: bring an archived custom category back into pickers. */
  restoreCategory: (id: string) => Promise<void>;
  /** R3a: "Not a transfer" decisions (pairs never suggested again). */
  transferDismissals: TransferDismissal[];
  /** R3a: Add Record → Transfer. Created approved (see addTransfer), audited 'created'. */
  addTransfer: (input: TransferInput) => Promise<Transaction>;
  /** R3a: Edit transfer — audited 'edited' with the changed field names. */
  updateTransfer: (id: string, input: TransferInput) => Promise<void>;
  /** R3a: approved income/expense → transfer (audited 'edited'). False when not allowed. */
  markAsTransfer: (id: string, otherAccountId: string) => Promise<boolean>;
  /** R3a: "It's a transfer" on a suggested pair. False when no longer a valid pair. */
  confirmTransferPair: (debitId: string, creditId: string) => Promise<boolean>;
  /** R3a: "Not a transfer". */
  dismissTransferPair: (debitId: string, creditId: string) => Promise<void>;
  /** R3a: "Undo transfer" on a paired transfer — restores both rows exactly. */
  undoTransfer: (transferId: string) => Promise<boolean>;
  /** R3b: "Not duplicates" decisions (pairs never suggested again). */
  duplicateDismissals: DuplicateDismissal[];
  /** R3b: link an income as a refund of an expense. Null = linked, else why not. */
  linkRefund: (refundId: string, expenseId: string) => Promise<RefundLinkError | 'missing' | null>;
  /** R3b: "Unlink refund" — the income counts as income again. */
  unlinkRefund: (refundId: string) => Promise<boolean>;
  /** R3b: keep `keptId`, hide `duplicateId` (rejected + link_kind duplicate). */
  markDuplicate: (keptId: string, duplicateId: string) => Promise<boolean>;
  /** R3b: "Not a duplicate" on a hidden row — restores it exactly. */
  /** `dismiss` also records "Not duplicates" so the pair is not re-suggested. */
  restoreDuplicate: (duplicateId: string, options?: { dismiss?: boolean }) => Promise<boolean>;
  /** R3b: "Not duplicates" on a suggestion. */
  dismissDuplicatePair: (aId: string, bId: string) => Promise<void>;
  /** R5e: "Do this automatically next time" meaning rules. */
  meaningRules: MeaningRule[];
  /** R5e: one meaning suggestion per transaction (open or closed). */
  meaningSuggestions: MeaningSuggestion[];
  /** R5e: new suggestions from sync / re-scan (an existing one is kept). */
  addMeaningSuggestions: (rows: ReadonlyArray<MeaningSuggestion>) => Promise<void>;
  /**
   * R5e T3: "Confirm transfer to <account>" — the item becomes an R3a
   * transfer (one db.transaction, audit 'transfer_marked' with snapshots).
   * `remember` stores / re-points the meaning rule. False when not allowed.
   */
  confirmMeaning: (transactionId: string, targetAccountId: string, options?: { remember?: boolean }) => Promise<boolean>;
  /**
   * R5e T2: a stored meaning rule converts a NEW pending item at insert
   * (status kept: still pending in manual mode). A pending counterpart SMS
   * on the target becomes its twin; an approved one is never touched (the
   * item stays a suggestion). False when it did not convert.
   */
  convertByMeaningRule: (transactionId: string, rule: MeaningRule) => Promise<boolean>;
  /** R5e T3: "It's an expense" / "It's income" — closes the suggestion (no money change). */
  dismissMeaning: (transactionId: string) => Promise<boolean>;
  /** R5e T3: Undo of a confirmed meaning — exact restore, suggestion reopened, rule reverted. */
  undoMeaning: (transferId: string) => Promise<boolean>;
  /**
   * R5e-FIX K1 (sync): a late counterpart SMS becomes the existing meaning
   * transfer's twin — never a second transfer. False when not allowed (N1
   * disagreement, duplicate / chain hold, or the transfer already has one).
   */
  attachMeaningTwin: (transactionId: string, transferId: string) => Promise<boolean>;
  /**
   * R5e-FIX M4: before an R2b link's rows are deleted, undo every transfer
   * pairing / meaning conversion that ties them to rows the link did NOT
   * insert, so those rows come back exactly.
   */
  releaseLinkedCounterparts: (insertedIds: ReadonlyArray<string>) => Promise<void>;
  /** R5e T3: Settings → Automatic money rules → Remove. */
  removeMeaningRule: (ruleId: string) => Promise<void>;
}

function transitionLocal(
  transaction: Transaction,
  to: TransactionStatus,
  now: string,
): Transaction {
  if (!canTransition(transaction.status, to)) return transaction;
  return {
    ...transaction,
    status: to,
    approvedAt: to === 'approved' ? now : transaction.approvedAt,
    updatedAt: now,
  };
}

/**
 * R5-fix C4 / R5d: the one-way keys a deleted SMS item leaves behind (null
 * for manual rows). The reference key is bound to type + amount.
 */
export function smsTombstoneFor(
  t: Pick<Transaction, 'sourceType' | 'sourceReferenceHash' | 'smsContentHash' | 'refDigest' | 'type' | 'amountMinor'>,
): SmsTombstoneInput | null {
  if (t.sourceType !== 'sms' || !t.sourceReferenceHash) return null;
  return {
    sourceReferenceHash: t.sourceReferenceHash,
    smsContentHash: t.smsContentHash ?? null,
    refKey: t.refDigest ? refTombstoneKey(t.refDigest, t.type, t.amountMinor) : null,
  };
}

function rulesToMap(rules: ReadonlyArray<MerchantRule>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rule of rules) map[rule.merchantKey] = rule.categoryId;
  return map;
}

async function loadAll() {
  const [
    transactions,
    accounts,
    categories,
    rules,
    transferDismissals,
    duplicateDismissals,
    meaningRules,
    meaningSuggestions,
    tags,
    tagLinks,
  ] = await Promise.all([
    transactionRepository.listAll(),
    accountRepository.listAllAccounts(),
    categoryRepository.listAll(),
    merchantRuleRepository.listAll(),
    transferRepository.listDismissals(),
    linkRepository.listDuplicateDismissals(),
    meaningRepository.listRules(),
    meaningRepository.listSuggestions(),
    // R11: tags must never block the app from opening.
    tagRepository.listTags().catch((): Tag[] => []),
    tagRepository.listLinks().catch((): Record<string, string[]> => ({})),
  ]);
  return {
    transactions,
    accounts,
    categories,
    merchantRules: rulesToMap(rules),
    transferDismissals,
    duplicateDismissals,
    meaningRules,
    meaningSuggestions,
    tags,
    tagLinks,
  };
}

/** R5e: suggestion rows closed by a confirm — the item's own, plus its twin's (if open). */
function closeSuggestions(
  suggestions: ReadonlyArray<MeaningSuggestion>,
  ownId: string,
  twinId: string | null,
  now: string,
  fallback: MeaningSuggestion | null,
): MeaningSuggestion[] {
  const out: MeaningSuggestion[] = [];
  const own = suggestions.find(s => s.transactionId === ownId) ?? fallback;
  if (own) out.push({ ...own, resolvedAt: now, resolution: 'transfer' });
  if (twinId) {
    const twin = suggestions.find(s => s.transactionId === twinId && s.resolvedAt == null);
    if (twin) out.push({ ...twin, resolvedAt: now, resolution: 'paired' });
  }
  return out;
}

/** R3b.1: an expense with linked refunds never changes type (to a transfer either). */
function refundBlocked(t: Transaction, transactions: ReadonlyArray<Transaction>): boolean {
  return linkedEditError(t, { type: 'transfer', amountMinor: t.amountMinor }, transactions) !== null;
}

/**
 * R5e-FIX M1 / M2 / M8 — what blocks an AUTOMATIC (rule / sync) meaning
 * step, so the row stays a held suggestion for the user: an N1
 * disagreement, an R3b duplicate pair (incl. chaining duplicates), or an R5g
 * chain outcome — except a chain 'transfer_twin' whose two sides are exactly
 * the row and its partner (that is the move the chain describes).
 */
function automaticMeaningBlocked(
  state: Pick<TransactionsState, 'transactions' | 'duplicateDismissals'>,
  row: Transaction,
  partner: Transaction | null,
): boolean {
  if (isRuleDisagreementRow(row) || (partner && isRuleDisagreementRow(partner))) return true;
  const chains = useChainSuggestions.getState().suggestions;
  const duplicates = findDuplicatePairs(state.transactions, state.duplicateDismissals, undefined, chainDuplicatePairs(chains));
  const ids = new Set([row.id, ...(partner ? [partner.id] : [])]);
  if (duplicates.some(p => ids.has(p.first.id) || ids.has(p.second.id))) return true;
  return chains.some(c => {
    const touches = ids.has(c.childId) || (c.parentId != null && ids.has(c.parentId));
    if (!touches) return false;
    const exactTwin =
      c.kind === 'transfer_twin' && partner != null && c.parentId != null && ids.has(c.childId) && ids.has(c.parentId);
    return !exactTwin;
  });
}

function mergeSuggestions(
  current: ReadonlyArray<MeaningSuggestion>,
  changed: ReadonlyArray<MeaningSuggestion>,
): MeaningSuggestion[] {
  const byId = new Map(changed.map(s => [s.transactionId, s]));
  const kept = current.map(s => byId.get(s.transactionId) ?? s);
  const known = new Set(current.map(s => s.transactionId));
  return [...kept, ...changed.filter(s => !known.has(s.transactionId))];
}

/** R5-fix C10: the hydrate currently running (shared by concurrent callers). */
let hydrateInFlight: Promise<void> | null = null;

export const useTransactionsStore = create<TransactionsState>((set, get) => {
  /**
   * R5e-FIX K1: hide `row` as the existing meaning transfer's twin (R3a twin
   * rules) — one db.transaction with a 'transfer_marked {twin_added}' audit
   * (ids / enums only); the row's open suggestion closes as 'paired'.
   */
  async function writeTwinAttach(row: Transaction, transfer: Transaction, actor: 'user' | 'system'): Promise<boolean> {
    const state = get();
    const mark = await meaningRepository.latestMark(transfer.id);
    if (!mark || mark.metadata.twin_id || findTransferTwin(state.transactions, transfer.id)) return false;
    const now = new Date().toISOString();
    const built = buildMeaningTwinAttach(row, transfer, now);
    if (!built) return false;
    const closed = state.meaningSuggestions
      .filter(s => s.transactionId === row.id && s.resolvedAt == null)
      .map(s => ({ ...s, resolvedAt: now, resolution: 'paired' as const }));
    await meaningRepository.confirm({
      transfer,
      twin: built.twin,
      suggestions: closed,
      rule: null,
      audit: {
        actor,
        meaning: mark.metadata.meaning,
        rule: actor === 'system',
        previous: built.previous,
        ruleId: null,
        ruleCreated: false,
        previousRuleTarget: null,
        twinAdded: true,
      },
    });
    set(current => ({
      transactions: current.transactions.map(t => (t.id === built.twin.id ? built.twin : t)),
      meaningSuggestions: mergeSuggestions(current.meaningSuggestions, closed),
    }));
    return true;
  }

  return {
  transactions: [],
  accounts: [],
  categories: [],
  merchantRules: {},
  transferDismissals: [],
  duplicateDismissals: [],
  meaningRules: [],
  meaningSuggestions: [],
  tags: [],
  tagLinks: {},
  isHydrated: false,
  hasOnboarded: false,
  userName: '',
  approvalMode: DEFAULT_APPROVAL_MODE,
  autoApproveThreshold: DEFAULT_AUTO_APPROVE_THRESHOLD,
  smsSyncStartMode: null,
  smsSyncStartAt: null,
  smsLastSyncedAt: null,
  transactionFilters: DEFAULT_TRANSACTION_FILTERS,
  selectedPeriod: DEFAULT_PERIOD,

  setTransactionFilters: patch => {
    set(state => ({ transactionFilters: { ...state.transactionFilters, ...patch } }));
    const next = get();
    persistFilters(next.transactionFilters, next.selectedPeriod);
  },

  resetTransactionFilters: () => {
    set({ transactionFilters: DEFAULT_TRANSACTION_FILTERS, selectedPeriod: DEFAULT_PERIOD });
    persistFilters(DEFAULT_TRANSACTION_FILTERS, DEFAULT_PERIOD);
  },

  setSelectedPeriod: period => {
    set({ selectedPeriod: period });
    persistFilters(get().transactionFilters, period);
  },

  // R5-fix C10: single-flight — a headless auto-read and the app launch
  // share ONE in-flight hydrate instead of two overlapping full reloads.
  hydrate: () => {
    if (hydrateInFlight) return hydrateInFlight;
    hydrateInFlight = (async () => {
      try {
        await runMigrations();
        await get().reloadFromDatabase();
        set({ isHydrated: true });
      } finally {
        hydrateInFlight = null;
      }
    })();
    return hydrateInFlight;
  },

  reloadFromDatabase: async () => {
    const [
      data,
      hasOnboardedValue,
      userNameValue,
      approvalModeValue,
      thresholdValue,
      startModeValue,
      startAtValue,
      lastSyncedValue,
      filtersValue,
    ] = await Promise.all([
      loadAll(),
      settingsRepository.getValue('has_onboarded'),
      settingsRepository.getValue(SETTINGS_KEYS.userName),
      settingsRepository.getValue(SETTINGS_KEYS.approvalMode),
      settingsRepository.getValue(SETTINGS_KEYS.autoApproveThreshold),
      settingsRepository.getValue(SMS_SYNC_KEYS.startMode),
      settingsRepository.getValue(SMS_SYNC_KEYS.startAt),
      settingsRepository.getValue(SMS_SYNC_KEYS.lastSyncedAt),
      readPersistedFilters().catch(() => null),
    ]);
    // R5j: restore the last-applied filters (ids that no longer exist are dropped).
    const restored = parsePersistedFilters(filtersValue, {
      accountIds: data.accounts.map(a => a.id),
      categoryIds: data.categories.map(c => c.id),
      tagKeys: data.tags.map(t => t.nameKey),
    });
    noteLoadedFilters(filtersValue);
    set({
      ...data,
      hasOnboarded: hasOnboardedValue === 'true',
      userName: (userNameValue ?? '').trim(),
      approvalMode: parseApprovalMode(approvalModeValue),
      autoApproveThreshold: parseThreshold(thresholdValue),
      smsSyncStartMode: parseStartMode(startModeValue),
      smsSyncStartAt: parseIsoOrNull(startAtValue),
      smsLastSyncedAt: parseIsoOrNull(lastSyncedValue),
      transactionFilters: restored?.filters ?? DEFAULT_TRANSACTION_FILTERS,
      selectedPeriod: restored?.period ?? DEFAULT_PERIOD,
    });
    // R4b: existing installs get a start without seeing the setup step again.
    // A failure here must never block the app from opening.
    await get()
      .applySmsSyncStartUpgrade()
      .catch(() => false);
  },

  applySmsSyncStartUpgrade: async (now = new Date()) => {
    const state = get();
    if (!state.hasOnboarded || state.smsSyncStartMode != null) return false;
    const firstRunStartedAtMs = await smsSyncRepository.firstRunStartedAtMs().catch(() => null);
    const bounds = smsTransactionBounds(state.transactions);
    const startAt = upgradeDefaultStart({
      firstRunStartedAtMs,
      earliestSmsTransactionAt: bounds.earliest,
      now,
    });
    await get().setSmsSyncStart('custom', startAt, 'system');
    // The old 200-cap sync already read the inbox up to its last run: the
    // newest SMS-sourced row is a safe (earlier) cursor, so the first sync
    // after the upgrade stays incremental (1-day overlap, dedup by hash).
    if (bounds.newest && get().smsLastSyncedAt == null) {
      await get().setSmsLastSyncedAt(bounds.newest);
    }
    return true;
  },

  setSmsSyncStart: async (mode, startAt, actor = 'user') => {
    const current = get();
    const fromMode = current.smsSyncStartMode ?? SETTING_UNSET;
    const fromAt =
      current.smsSyncStartMode == null ? SETTING_UNSET : current.smsSyncStartAt ?? '';
    const nextAt = mode === 'all' ? null : startAt;
    const toAt = nextAt ?? '';
    const audit: AuditEventInput[] = [];
    if (fromMode !== mode) {
      audit.push({
        eventType: 'settings_changed',
        actor,
        metadata: { kind: 'settings_changed', key: 'sms_sync_start_mode', from: fromMode, to: mode },
      });
    }
    if (fromAt !== toAt) {
      audit.push({
        eventType: 'settings_changed',
        actor,
        metadata: { kind: 'settings_changed', key: 'sms_sync_start_at', from: fromAt, to: toAt },
      });
    }
    await settingsRepository.setMany(
      [
        [SMS_SYNC_KEYS.startMode, mode],
        [SMS_SYNC_KEYS.startAt, toAt],
      ],
      audit,
    );
    set({ smsSyncStartMode: mode, smsSyncStartAt: nextAt });
  },

  setSmsLastSyncedAt: async iso => {
    await settingsRepository.setValue(SMS_SYNC_KEYS.lastSyncedAt, iso);
    set({ smsLastSyncedAt: iso });
  },

  approveAll: async ids => {
    const snapshots: ApprovalSnapshot[] = [];
    for (const id of ids) {
      const before = get().transactions.find(t => t.id === id);
      if (!before || !canTransition(before.status, 'approved')) continue;
      await get().approve(id);
      const after = get().transactions.find(t => t.id === id);
      if (after?.status === 'approved') {
        snapshots.push({ id, approvedAt: after.approvedAt, linkKind: after.linkKind ?? null });
      }
    }
    return snapshots;
  },

  undoApprovals: async snapshots => {
    let restored = 0;
    for (const snapshot of snapshots) {
      const current = get().transactions.find(t => t.id === snapshot.id);
      // Exact undo only: still approved by that same "Approve all", unlinked since.
      if (
        !current ||
        current.status !== 'approved' ||
        current.approvedAt !== snapshot.approvedAt ||
        (current.linkKind ?? null) !== snapshot.linkKind
      ) {
        continue;
      }
      const now = new Date().toISOString();
      // approved → pending is not a normal transition (canTransition): this
      // is the explicit Undo of the user's own bulk approval, audited.
      set(state => ({
        transactions: state.transactions.map(t =>
          t.id === snapshot.id ? { ...t, status: 'pending', approvedAt: null, updatedAt: now } : t,
        ),
      }));
      await transactionRepository
        .update(snapshot.id, { status: 'pending', approvedAt: null }, [
          {
            eventType: 'approval_undone',
            actor: 'user',
            metadata: { kind: 'approval_undone', transactionType: current.type },
          },
        ])
        .catch(() => get().refresh());
      restored++;
    }
    return restored;
  },

  completeOnboarding: async () => {
    await settingsRepository.setValue('has_onboarded', 'true');
    set({ hasOnboarded: true });
  },

  updateProfile: async patch => {
    const current = get();
    const next: Partial<Pick<TransactionsState, 'userName' | 'approvalMode' | 'autoApproveThreshold'>> = {};
    const entries: Array<readonly [string, string]> = [];
    const audit: AuditEventInput[] = [];

    if (patch.userName !== undefined) {
      // Saved but never audited — the name is not money-relevant.
      next.userName = patch.userName.trim();
      entries.push([SETTINGS_KEYS.userName, next.userName]);
    }
    if (patch.approvalMode !== undefined) {
      next.approvalMode = parseApprovalMode(patch.approvalMode);
      entries.push([SETTINGS_KEYS.approvalMode, next.approvalMode]);
      if (next.approvalMode !== current.approvalMode) {
        audit.push({
          eventType: 'settings_changed',
          actor: 'user',
          metadata: {
            kind: 'settings_changed',
            key: 'approval_mode',
            from: current.approvalMode,
            to: next.approvalMode,
          },
        });
      }
    }
    if (patch.autoApproveThreshold !== undefined) {
      next.autoApproveThreshold = clampThreshold(patch.autoApproveThreshold);
      entries.push([SETTINGS_KEYS.autoApproveThreshold, String(next.autoApproveThreshold)]);
      if (next.autoApproveThreshold !== current.autoApproveThreshold) {
        audit.push({
          eventType: 'settings_changed',
          actor: 'user',
          metadata: {
            kind: 'settings_changed',
            key: 'auto_approve_threshold',
            from: String(current.autoApproveThreshold),
            to: String(next.autoApproveThreshold),
          },
        });
      }
    }

    await settingsRepository.setMany(entries, audit);
    set(next);
  },

  refresh: async () => {
    const data = await loadAll();
    set(data);
  },

  approve: async (id, auto) => {
    const now = new Date().toISOString();
    const current = get().transactions.find(t => t.id === id);
    if (!current || !canTransition(current.status, 'approved')) return;

    // Home fast-approve, Pending and Detail all land here as 'approved';
    // only syncSms's opt-in auto mode passes `auto`.
    const audit: AuditEventDraft = auto
      ? {
          eventType: 'auto_approved',
          actor: auto.actor ?? 'system',
          metadata: {
            kind: 'auto_approved',
            confidence: auto.confidence,
            threshold: auto.threshold,
            transactionType: current.type,
          },
        }
      : {
          eventType: 'approved',
          actor: 'user',
          // B4: the type at event time (enum only).
          metadata: { kind: 'approved', transactionType: current.type },
        };

    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === id ? transitionLocal(t, 'approved', now) : t,
      ),
    }));

    await transactionRepository
      .update(id, { status: 'approved', approvedAt: now }, [audit])
      .catch(() => get().refresh());
  },

  reject: async id => {
    const now = new Date().toISOString();
    const current = get().transactions.find(t => t.id === id);
    if (!current || !canTransition(current.status, 'rejected')) return;

    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === id ? transitionLocal(t, 'rejected', now) : t,
      ),
    }));

    await transactionRepository
      .update(id, { status: 'rejected' }, [
        {
          eventType: 'rejected',
          actor: 'user',
          metadata: { kind: 'rejected', transactionType: current.type },
        },
      ])
      .catch(() => get().refresh());
  },

  addTagToTransaction: async (transactionId, name) => {
    const txn = get().transactions.find(t => t.id === transactionId);
    if (!txn) return null;
    const result = await tagRepository.attach(transactionId, txn.accountId, name);
    if (!result) return null;
    if (result.added) {
      set(state => ({
        tags: state.tags.some(t => t.id === result.tag.id) ? state.tags : [...state.tags, result.tag],
        tagLinks: {
          ...state.tagLinks,
          [transactionId]: [...(state.tagLinks[transactionId] ?? []), result.tag.id],
        },
      }));
    }
    return result.tag;
  },

  removeTagFromTransaction: async (transactionId, tagId) => {
    const txn = get().transactions.find(t => t.id === transactionId);
    const removed = await tagRepository.detach(transactionId, txn?.accountId ?? null, tagId);
    if (removed) {
      set(state => ({
        tagLinks: {
          ...state.tagLinks,
          [transactionId]: (state.tagLinks[transactionId] ?? []).filter(id => id !== tagId),
        },
      }));
    }
    return removed;
  },

  setReceiptPath: async (transactionId, receiptPath) => {
    const txn = get().transactions.find(t => t.id === transactionId);
    if (!txn) return false;
    await transactionRepository.setReceiptPath(transactionId, txn.accountId, receiptPath);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === transactionId ? { ...t, receiptPath } : t)),
    }));
    return true;
  },

  deleteTransaction: async id => {
    const current =
      get().transactions.find(t => t.id === id) ?? (await transactionRepository.getById(id));
    if (!current) return;
    await transactionRepository.delete(
      id,
      [
        {
          eventType: 'deleted',
          actor: 'user',
          metadata: {
            kind: 'deleted',
            merchantName: current.merchantName,
            amountMinor: current.amountMinor,
            type: current.type,
            status: current.status,
            transferAccountId: current.transferAccountId ?? null,
          },
        },
      ],
      current.accountId,
      smsTombstoneFor(current),
    );
    // R5b (D-e): deleting a transaction linked to a bill reopens that bill.
    // R11 (D-e): its receipt file goes with it (the tag links went in the repository).
    if (current.receiptPath) await deleteReceiptFile(current.receiptPath);
    await billRepository
      .reopenByPaidTransaction(id, current.amountMinor)
      .catch(() => undefined);
    await useBillsStore.getState().refresh().catch(() => undefined);
    await get().refresh();
  },

  addTransaction: async input => {
    // SMS rows are 'detected' by the system. R5 (owner, 2026-11-06): a record
    // the user typed — Add Record, or "Add as transaction" from Messages not
    // understood — is saved approved and audited 'added' by the user. A
    // user-entered row that is still pending (pre-R5 callers) stays 'created'.
    const userEntered =
      input.sourceType === 'manual' || input.parserVersion === SMS_USER_ADDED_PARSER_VERSION;
    const audit: AuditEventDraft = userEntered
      ? input.status === 'approved'
        ? {
            eventType: 'added',
            actor: 'user',
            metadata: { kind: 'added', transactionType: input.type },
          }
        : {
            eventType: 'created',
            actor: 'user',
            metadata: { kind: 'created', transactionType: input.type },
          }
      : {
          eventType: 'detected',
          actor: 'system',
          metadata: {
            kind: 'detected',
            confidence: input.confidenceScore,
            transactionType: input.type,
          },
        };
    const created = await transactionRepository.create(input, [audit]);
    set(state => ({ transactions: [created, ...state.transactions] }));
    return created;
  },

  updateTransaction: async (id, patch) => {
    const existing =
      get().transactions.find(t => t.id === id) ?? (await transactionRepository.getById(id));
    // R3b.1: the same guard the Edit form shows inline — hidden rows are never
    // edited, refund links never break through an edit.
    if (
      existing &&
      linkedEditError(
        existing,
        {
          type: patch.type ?? existing.type,
          amountMinor: patch.amountMinor ?? existing.amountMinor,
        },
        get().transactions,
      )
    ) {
      return false;
    }
    const fields = existing ? changedTransactionFields(existing, patch) : [];
    // A save that changes nothing is not a money change: no audit row.
    // B4: plus the type after the edit, and from/to when the type changed
    // (Mark as transfer records e.g. expense → transfer).
    const audit: AuditEventDraft[] =
      existing && fields.length > 0
        ? [{ eventType: 'edited', actor: 'user', metadata: editedMetadata(existing, patch, fields) }]
        : [];
    const updated = await transactionRepository.update(id, patch, audit);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === id ? updated : t)),
    }));
    // R5e-FIX M6: a type change makes an open meaning stale (its direction
    // came from the old type) — close it; it never acts on the new type.
    const open = existing && patch.type != null && patch.type !== existing.type
      ? get().meaningSuggestions.find(s => s.transactionId === id && s.resolvedAt == null)
      : undefined;
    if (open) {
      const closed: MeaningSuggestion = { ...open, resolvedAt: new Date().toISOString(), resolution: 'expense' };
      await meaningRepository.resolveSuggestion(closed);
      set(state => ({ meaningSuggestions: mergeSuggestions(state.meaningSuggestions, [closed]) }));
    }
    return true;
  },

  addAccount: async input => {
    const created = await accountRepository.create(input, [
      { eventType: 'account_created', actor: 'user' },
    ]);
    set(state => ({ accounts: [...state.accounts, created] }));
  },

  updateAccount: async (id, patch) => {
    const existing =
      get().accounts.find(a => a.id === id) ?? (await accountRepository.getById(id));
    const fields = existing ? changedAccountFields(existing, patch) : [];
    const audit: AuditEventDraft[] =
      fields.length > 0
        ? [
            {
              eventType: 'account_updated',
              actor: 'user',
              metadata: { kind: 'account_updated', fields },
            },
          ]
        : [];
    const updated = await accountRepository.update(id, patch, audit);
    set(state => ({ accounts: state.accounts.map(a => (a.id === id ? updated : a)) }));
  },

  applyBankBalance: async id => {
    const account = get().accounts.find(a => a.id === id);
    if (!account || account.smsBalanceMinor == null) return false;
    await get().updateAccount(id, {
      balanceAnchorMinor: account.smsBalanceMinor,
      // The bank figure is true AS OF the SMS: anchor there, so rows dated
      // after it keep counting toward the current balance.
      balanceAnchorAt: account.smsBalanceAt ?? new Date().toISOString(),
    });
    return true;
  },

  dismissBalanceDifference: async id => {
    await accountRepository.dismissSmsBalanceDifference(id);
    set(state => ({
      accounts: state.accounts.map(a =>
        a.id === id && a.smsBalanceAt != null ? { ...a, smsBalanceDismissedAt: a.smsBalanceAt } : a,
      ),
    }));
  },

  removeAccount: async id => {
    await accountRepository.softDelete(id, [{ eventType: 'account_removed', actor: 'user' }]);
    await get().refresh();
  },

  restoreAccount: async id => {
    await accountRepository.restore(id, [{ eventType: 'account_restored', actor: 'user' }]);
    await get().refresh();
  },

  importSuggestion: async input => {
    const result = await suggestionRepository.importSuggestion(input);
    set(state => ({
      accounts: result.account ? [...state.accounts, result.account] : state.accounts,
      transactions: [...result.transactions, ...state.transactions],
    }));
    return result;
  },

  ignoreSuggestion: async key => {
    await accountRepository.ignoreSuggestion(key);
  },

  unignoreSuggestion: async key => {
    await accountRepository.unignoreSuggestion(key);
  },

  backfillSmsContentHashes: async rows => {
    if (rows.length === 0) return;
    await transactionRepository.setContentHashes(rows);
    const byId = new Map(rows.map(row => [row.id, row.smsContentHash]));
    set(state => ({
      transactions: state.transactions.map(t =>
        byId.has(t.id) ? { ...t, smsContentHash: byId.get(t.id) ?? null } : t,
      ),
    }));
  },

  undoLinkSuggestion: async input => {
    const removed = await suggestionRepository.undoLink(input);
    const ids = new Set(input.pending.map(row => row.id));
    set(state => ({
      transactions: state.transactions.filter(t => !ids.has(t.id)),
      meaningSuggestions: state.meaningSuggestions.filter(s => !ids.has(s.transactionId)),
    }));
    return removed;
  },

  saveMerchantRule: async (merchantName, categoryId, transactionId = null) => {
    const key = normalizeMerchant(merchantName);
    if (key === '') return;
    const transaction = transactionId
      ? get().transactions.find(t => t.id === transactionId) ?? null
      : null;
    // Metadata is the category id only; the triggering item (if any) lets
    // Activity name the merchant without storing merchant text in the rule event.
    await merchantRuleRepository.upsert(key, categoryId, [
      {
        eventType: 'rule_saved',
        actor: 'user',
        metadata: { kind: 'rule_saved', categoryId },
        transactionId: transaction?.id ?? null,
        accountId: transaction?.accountId ?? null,
      },
    ]);
    set(state => ({ merchantRules: { ...state.merchantRules, [key]: categoryId } }));
  },

  deleteMerchantRule: async merchantKey => {
    const categoryId = get().merchantRules[merchantKey];
    if (categoryId === undefined) return;
    await merchantRuleRepository.delete(merchantKey, [
      { eventType: 'rule_deleted', actor: 'user', metadata: { kind: 'rule_deleted', categoryId } },
    ]);
    set(state => {
      const next = { ...state.merchantRules };
      delete next[merchantKey];
      return { merchantRules: next };
    });
  },

  ruleTargets: (merchantName, categoryId, excludeId) =>
    ruleApplyTargets(get().transactions, normalizeMerchant(merchantName), categoryId, excludeId),

  applyCategoryChanges: async changes => {
    // Re-read the live categories so Undo restores what was really there.
    const byId = new Map(get().transactions.map(t => [t.id, t]));
    const live: CategoryChange[] = [];
    const types = new Map<string, Transaction['type']>();
    for (const change of changes) {
      const current = byId.get(change.id);
      if (!current || current.categoryId === change.toCategoryId) continue;
      live.push({ ...change, accountId: current.accountId, fromCategoryId: current.categoryId });
      types.set(change.id, current.type);
    }
    if (live.length === 0) return [];
    const updatedAt = await transactionRepository.setCategories(
      live.map(c => ({
        id: c.id,
        accountId: c.accountId,
        categoryId: c.toCategoryId,
        transactionType: types.get(c.id),
      })),
    );
    const target = new Map(live.map(c => [c.id, c.toCategoryId]));
    set(state => ({
      transactions: state.transactions.map(t =>
        target.has(t.id) ? { ...t, categoryId: target.get(t.id) as string, updatedAt } : t,
      ),
    }));
    return live;
  },

  undoCategoryChanges: async applied => {
    await get().applyCategoryChanges(invertChanges(applied));
  },

  addCategory: async input => {
    const created = await categoryRepository.create(input, category => [
      {
        eventType: 'category_created',
        actor: 'user',
        metadata: { kind: 'category_created', categoryId: category.id },
      },
    ]);
    set(state => ({ categories: [...state.categories, created] }));
    return created;
  },

  updateCategory: async (id, patch) => {
    const existing = get().categories.find(c => c.id === id);
    if (!existing) return;
    const fields = (['name', 'icon', 'color'] as const).filter(
      field => patch[field] !== undefined && patch[field] !== existing[field],
    );
    if (fields.length === 0) return;
    const updated = await categoryRepository.update(id, patch, [
      {
        eventType: 'category_updated',
        actor: 'user',
        metadata: { kind: 'category_updated', categoryId: id, fields: [...fields] },
      },
    ]);
    set(state => ({ categories: state.categories.map(c => (c.id === id ? updated : c)) }));
  },

  archiveCategory: async id => {
    const existing = get().categories.find(c => c.id === id);
    if (!existing || existing.archivedAt !== null) return;
    const archived = await categoryRepository.archive(id, [
      {
        eventType: 'category_archived',
        actor: 'user',
        metadata: { kind: 'category_archived', categoryId: id },
      },
    ]);
    set(state => ({ categories: state.categories.map(c => (c.id === id ? archived : c)) }));
  },

  restoreCategory: async id => {
    const existing = get().categories.find(c => c.id === id);
    if (!existing || existing.isSystem || existing.archivedAt === null) return;
    const restored = await categoryRepository.restore(id, [
      {
        eventType: 'category_restored',
        actor: 'user',
        metadata: { kind: 'category_restored', categoryId: id },
      },
    ]);
    set(state => ({ categories: state.categories.map(c => (c.id === id ? restored : c)) }));
  },

  addTransfer: async input => {
    // A transfer is the user moving their own money — not a detection to
    // review — so it is recorded approved (it never counts as income or
    // expense; it only moves balances). Audited 'created' by the user.
    const now = new Date().toISOString();
    const created = await transactionRepository.create(
      {
        type: 'transfer',
        status: 'approved',
        amountMinor: input.amountMinor,
        currency: 'INR',
        merchantName: MANUAL_TRANSFER_TITLE,
        categoryId: TRANSFER_CATEGORY_ID,
        accountId: input.fromAccountId,
        transferAccountId: input.toAccountId,
        paymentMethod: 'bank',
        occurredAt: input.occurredAt,
        detectedAt: now,
        approvedAt: now,
        note: input.note,
        sourceType: input.smsReference ? 'sms' : 'manual',
        sourceReferenceHash: input.smsReference?.hash ?? null,
        smsContentHash: input.smsReference?.contentHash ?? null,
        sanitizedPreview: null,
        confidenceScore: null,
        parserVersion: input.smsReference?.parserVersion ?? null,
      },
      [
        {
          eventType: 'created',
          actor: 'user',
          metadata: { kind: 'created', transactionType: 'transfer' },
        },
      ],
    );
    set(state => ({ transactions: [created, ...state.transactions] }));
    return created;
  },

  updateTransfer: async (id, input) => {
    const existing = get().transactions.find(t => t.id === id);
    if (!existing || existing.type !== 'transfer') return;
    await get().updateTransaction(id, {
      accountId: input.fromAccountId,
      transferAccountId: input.toAccountId,
      amountMinor: input.amountMinor,
      occurredAt: input.occurredAt,
      note: input.note,
    });
  },

  markAsTransfer: async (id, otherAccountId) => {
    const existing = get().transactions.find(t => t.id === id);
    if (!existing) return false;
    const patch = markAsTransferPatch(existing, otherAccountId);
    if (!patch) return false;
    // Audited 'edited' with the field names that really changed
    // (type, transferAccountId, plus categoryId / accountId when they move).
    // R3b.1: an expense with linked refunds cannot become a transfer.
    return get().updateTransaction(id, patch);
  },

  confirmTransferPair: async (debitId, creditId) => {
    const byId = new Map(get().transactions.map(t => [t.id, t]));
    const debit = byId.get(debitId);
    const credit = byId.get(creditId);
    if (!debit || !credit) return false;
    const now = new Date().toISOString();
    const confirmation = buildPairConfirmation(debit, credit, now);
    if (!confirmation) return false;
    // R5e: confirming the pair resolves both rows' open meaning suggestions.
    const paired = get()
      .meaningSuggestions.filter(
        s => (s.transactionId === debitId || s.transactionId === creditId) && s.resolvedAt == null,
      )
      .map(s => ({ ...s, resolvedAt: now, resolution: 'paired' as const }));
    await transferRepository.confirmPair(
      confirmation.debit,
      confirmation.credit,
      confirmation.previous,
      paired,
    );
    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === debitId ? confirmation.debit : t.id === creditId ? confirmation.credit : t,
      ),
      meaningSuggestions: mergeSuggestions(state.meaningSuggestions, paired),
    }));
    return true;
  },

  dismissTransferPair: async (debitId, creditId) => {
    const dismissal = await transferRepository.dismissPair(debitId, creditId);
    set(state => ({ transferDismissals: [...state.transferDismissals, dismissal] }));
  },

  undoTransfer: async transferId => {
    const transactions = get().transactions;
    const debit = transactions.find(t => t.id === transferId);
    const twin = findTransferTwin(transactions, transferId);
    if (!debit || debit.type !== 'transfer') return false;
    const pairing = twin ? await transferRepository.latestPairing(transferId) : null;
    // R5e: a transfer made by a confirmed meaning undoes through its own
    // 'transfer_marked' snapshot when that is the newest. R5e-FIX K2: also
    // with no twin; K1: a late twin comes back first, then the conversion —
    // "Undo transfer" brings back every SMS item exactly as it was.
    const mark = await meaningRepository.latestMark(transferId);
    if (mark && (!pairing || (pairing.eventAt ?? '') <= mark.eventAt)) {
      let next: typeof mark | null = mark;
      while (next) {
        if (!(await get().undoMeaning(transferId))) return false;
        if (!next.metadata.twin_added) return true;
        next = await meaningRepository.latestMark(transferId);
      }
      return true;
    }
    if (!twin || !pairing || pairing.metadata.credit_id !== twin.id) return false;
    const now = new Date().toISOString();
    const restored = undoTransferPair(debit, twin, pairing.metadata.previous, now);
    if (!restored) return false;
    // R5e: suggestions the pair confirm closed as 'paired' open again.
    const reopened = get()
      .meaningSuggestions.filter(
        s => (s.transactionId === debit.id || s.transactionId === twin.id) && s.resolution === 'paired',
      )
      .map(s => ({ ...s, resolvedAt: null, resolution: null }));
    await transferRepository.undoPair(restored.debit, restored.credit, reopened);
    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === restored.debit.id ? restored.debit : t.id === restored.credit.id ? restored.credit : t,
      ),
      meaningSuggestions: mergeSuggestions(state.meaningSuggestions, reopened),
    }));
    return true;
  },

  addMeaningSuggestions: async rows => {
    const known = new Set(get().meaningSuggestions.map(s => s.transactionId));
    const fresh = rows.filter(s => !known.has(s.transactionId));
    if (fresh.length === 0) return;
    await meaningRepository.addSuggestions(fresh);
    set(state => ({ meaningSuggestions: mergeSuggestions(state.meaningSuggestions, fresh) }));
  },

  confirmMeaning: async (transactionId, targetAccountId, options = {}) => {
    const state = get();
    const row = state.transactions.find(t => t.id === transactionId);
    const suggestion = state.meaningSuggestions.find(s => s.transactionId === transactionId && s.resolvedAt == null);
    if (!row || !suggestion) return false;
    if (!activeAccounts(state.accounts).some(a => a.id === targetAccountId)) return false;
    // R5e-FIX M6: the suggestion's direction must still match the item's type.
    if (meaningSideOf(row.type) !== candidateFromSuggestion(suggestion, row.accountId).side) return false;
    // R5e-FIX M5 (R3b.1): an expense with linked refunds never becomes a transfer.
    if (refundBlocked(row, state.transactions)) return false;
    const now = new Date().toISOString();
    // R3a twin rules: the counterpart SMS on the target becomes the twin —
    // R5e-FIX M2: also outside R3a's 24 h (the same move's other alert).
    const partner =
      meaningPartner(row, targetAccountId, state.transactions, state.accounts, state.transferDismissals) ??
      meaningCounterpart(row, suggestion.kind, targetAccountId, state.transactions, state.meaningSuggestions);
    if (partner && refundBlocked(partner, state.transactions)) return false;
    if (!partner) {
      // R5e-FIX K1: the move is already a transfer — this row is its late twin.
      const late = lateMeaningTransfer(row, suggestion.kind, state.transactions, state.meaningSuggestions);
      const other = late ? (row.type === 'income' ? late.accountId : late.transferAccountId) : null;
      if (late && other === targetAccountId) return writeTwinAttach(row, late, 'user');
    }
    const conversion = buildMeaningConversion(row, targetAccountId, partner, now, { approve: true });
    if (!conversion) return false;
    const plan = options.remember
      ? planMeaningRule(state.meaningRules, suggestion, targetAccountId, generateId('mrule'), now)
      : null;
    const twinId = conversion.twin?.id ?? null;
    const otherId = conversion.transfer.id === transactionId ? twinId : conversion.transfer.id;
    const closed = closeSuggestions(state.meaningSuggestions, transactionId, otherId, now, null);
    await meaningRepository.confirm({
      transfer: conversion.transfer,
      twin: conversion.twin,
      suggestions: closed,
      rule: plan?.write ?? null,
      audit: {
        actor: 'user',
        meaning: suggestion.kind,
        rule: false,
        previous: conversion.previous,
        ruleId: plan?.ruleId ?? null,
        ruleCreated: plan?.created ?? false,
        previousRuleTarget: plan?.previousTarget ?? null,
      },
    });
    set(current => ({
      transactions: current.transactions.map(t =>
        t.id === conversion.transfer.id ? conversion.transfer : conversion.twin && t.id === conversion.twin.id ? conversion.twin : t,
      ),
      meaningSuggestions: mergeSuggestions(current.meaningSuggestions, closed),
      meaningRules: applyRuleWrite(current.meaningRules, plan?.write ?? null),
    }));
    return true;
  },

  convertByMeaningRule: async (transactionId, rule) => {
    const state = get();
    const row = state.transactions.find(t => t.id === transactionId);
    if (!row || row.status !== 'pending') return false;
    if (!activeAccounts(state.accounts).some(a => a.id === rule.targetAccountId)) return false;
    // R5e-FIX M6: the rule's side ('in:' key) must match the item's type.
    if (meaningSideOf(row.type) !== candidateFromSuggestion(rule, row.accountId).side) return false;
    if (refundBlocked(row, state.transactions)) return false;
    let partner = meaningPartner(row, rule.targetAccountId, state.transactions, state.accounts, state.transferDismissals);
    // A pair with ANOTHER account is a different reading — both wait for the user.
    if (!partner && isInTransferPair(row.id, state.transactions, state.accounts, state.transferDismissals)) return false;
    if (!partner) {
      // R5e-FIX K1: already a transfer → never a second one (sync attaches the twin).
      if (lateMeaningTransfer(row, rule.kind, state.transactions, state.meaningSuggestions)) return false;
      // R5e-FIX M2: the same move's other alert outside R3a's 24 h is the partner.
      partner = meaningCounterpart(row, rule.kind, rule.targetAccountId, state.transactions, state.meaningSuggestions);
    }
    // Never touch an approved row without the user.
    if (partner && (partner.status !== 'pending' || refundBlocked(partner, state.transactions))) return false;
    // R5e-FIX M1 / M2 / M8: duplicates, chain holds and N1 disagreements wait for the user.
    if (automaticMeaningBlocked(state, row, partner)) return false;
    const now = new Date().toISOString();
    const conversion = buildMeaningConversion(row, rule.targetAccountId, partner, now, { approve: false });
    if (!conversion) return false;
    const own: MeaningSuggestion = {
      transactionId,
      kind: rule.kind,
      targetAccountId: rule.targetAccountId,
      reason: 'rule',
      bankCanonical: rule.bankCanonical,
      counterpartyKey: rule.counterpartyKey,
      createdAt: now,
      resolvedAt: null,
      resolution: null,
    };
    const otherId = conversion.transfer.id === transactionId ? conversion.twin?.id ?? null : conversion.transfer.id;
    const closed = closeSuggestions(state.meaningSuggestions, transactionId, otherId, now, own);
    await meaningRepository.confirm({
      transfer: conversion.transfer,
      twin: conversion.twin,
      suggestions: closed,
      rule: null,
      audit: {
        actor: 'system',
        meaning: rule.kind,
        rule: true,
        previous: conversion.previous,
        ruleId: rule.id,
        ruleCreated: false,
        previousRuleTarget: rule.targetAccountId,
      },
    });
    set(current => ({
      transactions: current.transactions.map(t =>
        t.id === conversion.transfer.id ? conversion.transfer : conversion.twin && t.id === conversion.twin.id ? conversion.twin : t,
      ),
      meaningSuggestions: mergeSuggestions(current.meaningSuggestions, closed),
    }));
    return true;
  },

  dismissMeaning: async transactionId => {
    const suggestion = get().meaningSuggestions.find(s => s.transactionId === transactionId && s.resolvedAt == null);
    if (!suggestion) return false;
    const closed: MeaningSuggestion = { ...suggestion, resolvedAt: new Date().toISOString(), resolution: 'expense' };
    await meaningRepository.resolveSuggestion(closed);
    set(state => ({ meaningSuggestions: mergeSuggestions(state.meaningSuggestions, [closed]) }));
    return true;
  },

  undoMeaning: async transferId => {
    const state = get();
    const transfer = state.transactions.find(t => t.id === transferId);
    if (!transfer) return false;
    const mark = await meaningRepository.latestMark(transferId);
    if (!mark) return false;
    const md = mark.metadata;
    const twin = md.twin_id ? state.transactions.find(t => t.id === md.twin_id) ?? null : null;
    const now = new Date().toISOString();
    const restored = undoMeaningConversion(transfer, twin, md.previous, now);
    if (!restored) return false;
    if (md.twin_added && restored.twin) {
      // R5e-FIX K1: only the late twin comes back; the transfer is untouched.
      const back = restored.twin;
      const reopenedTwin = state.meaningSuggestions
        .filter(s => s.transactionId === back.id && s.resolution === 'paired')
        .map(s => ({ ...s, resolvedAt: null, resolution: null }));
      await meaningRepository.undo({
        transfer,
        twin: back,
        suggestions: reopenedTwin,
        rule: null,
        meaning: md.meaning,
        twinOnly: true,
      });
      set(current => ({
        transactions: current.transactions.map(t => (t.id === back.id ? back : t)),
        meaningSuggestions: mergeSuggestions(current.meaningSuggestions, reopenedTwin),
      }));
      return true;
    }
    const ids = new Set([transfer.id, ...(twin ? [twin.id] : [])]);
    const reopened = state.meaningSuggestions
      .filter(s => ids.has(s.transactionId) && (s.resolution === 'transfer' || s.resolution === 'paired'))
      .map(s => ({ ...s, resolvedAt: null, resolution: null }));
    // Undo also removes the rule this confirm created (or re-points it back).
    let rule: MeaningRuleWrite | null = null;
    if (md.rule_id && !md.rule) {
      const current = state.meaningRules.find(r => r.id === md.rule_id);
      if (md.rule_created && current) rule = { op: 'delete', id: md.rule_id };
      else if (!md.rule_created && current && md.previous_rule_target && current.targetAccountId !== md.previous_rule_target) {
        rule = { op: 'retarget', id: md.rule_id, targetAccountId: md.previous_rule_target };
      }
    }
    await meaningRepository.undo({
      transfer: restored.transfer,
      twin: restored.twin,
      suggestions: reopened,
      rule,
      meaning: md.meaning,
    });
    set(current => ({
      transactions: current.transactions.map(t =>
        t.id === restored.transfer.id ? restored.transfer : restored.twin && t.id === restored.twin.id ? restored.twin : t,
      ),
      meaningSuggestions: mergeSuggestions(current.meaningSuggestions, reopened),
      meaningRules: applyRuleWrite(current.meaningRules, rule),
    }));
    return true;
  },

  attachMeaningTwin: async (transactionId, transferId) => {
    const state = get();
    const row = state.transactions.find(t => t.id === transactionId);
    const transfer = state.transactions.find(t => t.id === transferId);
    if (!row || !transfer || row.status !== 'pending') return false;
    if (refundBlocked(row, state.transactions) || automaticMeaningBlocked(state, row, transfer)) return false;
    return writeTwinAttach(row, transfer, 'system');
  },

  releaseLinkedCounterparts: async insertedIds => {
    const inserted = new Set(insertedIds);
    for (const id of insertedIds) {
      const current = get().transactions;
      const row = current.find(t => t.id === id);
      if (!row) continue;
      if (row.type === 'transfer') {
        // An inserted row became the transfer of a pre-existing twin.
        const twin = findTransferTwin(current, row.id);
        if (twin && !inserted.has(twin.id)) await get().undoTransfer(row.id);
        continue;
      }
      if (row.linkKind !== 'transfer_twin' || !row.linkedTransactionId || inserted.has(row.linkedTransactionId)) continue;
      // An inserted row hidden as the twin of a pre-existing transfer: a late
      // twin (K1) only detaches; a pairing / conversion it took part in undoes.
      const mark = await meaningRepository.latestMark(row.linkedTransactionId);
      if (mark?.metadata.twin_added && mark.metadata.twin_id === row.id) await get().undoMeaning(row.linkedTransactionId);
      else await get().undoTransfer(row.linkedTransactionId);
    }
  },

  removeMeaningRule: async ruleId => {
    const rule = get().meaningRules.find(r => r.id === ruleId);
    if (!rule) return;
    await meaningRepository.removeRule(rule);
    set(state => ({ meaningRules: state.meaningRules.filter(r => r.id !== ruleId) }));
  },

  linkRefund: async (refundId, expenseId) => {
    const transactions = get().transactions;
    const refund = transactions.find(t => t.id === refundId);
    const expense = transactions.find(t => t.id === expenseId);
    if (!refund || !expense) return 'missing';
    const error = validateRefundLink(refund, expense, transactions);
    if (error) return error;
    const linked = linkRefundPatch(refund, expense, new Date().toISOString());
    await linkRepository.linkRefund(linked, expense.id, refund.categoryId);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === linked.id ? linked : t)),
    }));
    return null;
  },

  unlinkRefund: async refundId => {
    const refund = get().transactions.find(t => t.id === refundId);
    if (!refund || !isLinkedRefund(refund)) return false;
    const expenseId = refund.linkedTransactionId as string;
    const link = await linkRepository.latestRefundLink(refundId, expenseId);
    const unlinked = unlinkRefundPatch(
      refund,
      link?.previous_category_id ?? null,
      link?.category_id ?? null,
      new Date().toISOString(),
    );
    if (!unlinked) return false;
    await linkRepository.unlinkRefund(unlinked, expenseId);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === unlinked.id ? unlinked : t)),
    }));
    return true;
  },

  markDuplicate: async (keptId, duplicateId) => {
    const byId = new Map(get().transactions.map(t => [t.id, t]));
    const kept = byId.get(keptId);
    const duplicate = byId.get(duplicateId);
    if (!kept || !duplicate) return false;
    const marking = buildDuplicateMarking(kept, duplicate, new Date().toISOString());
    if (!marking) return false;
    await linkRepository.markDuplicate(marking.duplicate, kept.id, marking.previous);
    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === marking.duplicate.id ? marking.duplicate : t,
      ),
    }));
    return true;
  },

  restoreDuplicate: async (duplicateId, options = {}) => {
    const hidden = get().transactions.find(t => t.id === duplicateId);
    if (!hidden || hidden.linkKind !== 'duplicate' || hidden.linkedTransactionId == null) {
      return false;
    }
    const keptId = hidden.linkedTransactionId;
    const mark = await linkRepository.latestDuplicateMark(duplicateId, keptId);
    if (!mark) return false;
    const restored = buildDuplicateRestore(hidden, mark.previous, new Date().toISOString());
    if (!restored) return false;
    const dismissal = await linkRepository.restoreDuplicate(restored, keptId, options);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === restored.id ? restored : t)),
      duplicateDismissals: dismissal
        ? [...state.duplicateDismissals, dismissal]
        : state.duplicateDismissals,
    }));
    return true;
  },

  dismissDuplicatePair: async (aId, bId) => {
    const dismissal = await linkRepository.dismissDuplicatePair(aId, bId);
    set(state => ({ duplicateDismissals: [...state.duplicateDismissals, dismissal] }));
  },
  };
});

/** R5e: the in-memory rules after a confirm / undo wrote one. */
function applyRuleWrite(rules: ReadonlyArray<MeaningRule>, write: MeaningRuleWrite | null): MeaningRule[] {
  if (!write) return [...rules];
  if (write.op === 'insert') return [...rules.filter(r => r.id !== write.rule.id), write.rule];
  if (write.op === 'retarget') {
    return rules.map(r => (r.id === write.id ? { ...r, targetAccountId: write.targetAccountId } : r));
  }
  return rules.filter(r => r.id !== write.id);
}

/** R3b: live refunds linked to an expense (used by Detail + the delete guard). */
export function linkedRefundsOf(
  state: Pick<TransactionsState, 'transactions'>,
  expenseId: string,
): Transaction[] {
  return refundsFor(state.transactions, expenseId);
}

/**
 * `accounts` holds ALL accounts (incl. soft-deleted, for transaction labels).
 * These selectors return new arrays — wrap call sites in `useShallow`.
 */
export const selectActiveAccounts = (state: Pick<TransactionsState, 'accounts'>) =>
  activeAccounts(state.accounts);

export const selectDeletedAccounts = (state: Pick<TransactionsState, 'accounts'>) =>
  deletedAccounts(state.accounts);

export const selectPending = (state: TransactionsState) =>
  state.transactions.filter(t => t.status === 'pending');

export const selectApproved = (state: TransactionsState) =>
  state.transactions.filter(t => t.status === 'approved');
